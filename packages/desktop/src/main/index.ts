import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import path from 'node:path';
import {
  AppError, Database, Logger, ProfileStore,
  exportApplications, exportCandidates,
  listModels, runLlmAnalysis, runScreening,
  sendDecisionEmails, testConnections,
  type EmailKind, type ScreeningInput, type SettingsProfile, type Tier,
} from '@avanzare/engine';

let win: BrowserWindow | null = null;
let db: Database;
let profiles: ProfileStore;
let logger: Logger;

// ---------- profile secret handling (SMTP password encrypted at rest) ----------

const ENC_PREFIX = 'enc:';

function sealProfile(p: SettingsProfile): SettingsProfile {
  if (p.smtp.pass && !p.smtp.pass.startsWith(ENC_PREFIX) && safeStorage.isEncryptionAvailable()) {
    return { ...p, smtp: { ...p.smtp, pass: ENC_PREFIX + safeStorage.encryptString(p.smtp.pass).toString('base64') } };
  }
  return p;
}

function unsealProfile(p: SettingsProfile): SettingsProfile {
  if (p.smtp.pass?.startsWith(ENC_PREFIX) && safeStorage.isEncryptionAvailable()) {
    try {
      return { ...p, smtp: { ...p.smtp, pass: safeStorage.decryptString(Buffer.from(p.smtp.pass.slice(ENC_PREFIX.length), 'base64')) } };
    } catch {
      return { ...p, smtp: { ...p.smtp, pass: '' } };
    }
  }
  return p;
}

// ---------- uniform IPC envelope: every handler returns {ok} and never throws ----------

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; location: string } };

function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Envelope<T>> => {
    try {
      return { ok: true, data: await fn(...(args as never[])) };
    } catch (err) {
      const e = err instanceof AppError
        ? err
        : new AppError('AVZ-APP-901', channel, err instanceof Error ? err.message : String(err));
      logger.error(e.message, { code: e.code, location: e.location, channel });
      return { ok: false, error: { code: e.code, message: e.message, location: e.location } };
    }
  });
}

function sendProgress(payload: unknown): void {
  win?.webContents.send('avz:progress', payload);
}

function registerIpc(): void {
  handle('profiles:list', () => profiles.list().map(unsealProfile));
  handle('profiles:save', (p: SettingsProfile) => { profiles.save(sealProfile(p)); });
  handle('profiles:delete', (name: string) => { profiles.delete(name); });

  handle('connections:test', (p: SettingsProfile) => testConnections(p));
  handle('llm:models', (llm: SettingsProfile['llm']) => listModels(llm));

  handle('screening:run', (input: ScreeningInput) => runScreening(input, db, sendProgress));

  handle('applications:setTier', (ids: number[], tier: Tier) => {
    for (const id of ids) db.setApplicationTier(id, tier);
  });

  handle('llm:analyze', async (payload: { jobId: number; applicationIds: number[]; profile: SettingsProfile }) => {
    const { failures } = await runLlmAnalysis(
      payload.jobId, payload.applicationIds, payload.profile.llm, db, payload.profile.concurrency, sendProgress,
    );
    const rows = db.getApplications(payload.applicationIds)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return { rows, failures };
  });

  handle('emails:send', async (payload: {
    jobId: number; profile: SettingsProfile;
    batches: { kind: EmailKind; applicationIds: number[] }[];
  }) => {
    const job = db.getJob(payload.jobId);
    const reports = [];
    for (const batch of payload.batches) {
      const apps = db.getApplications(batch.applicationIds);
      reports.push({
        kind: batch.kind,
        report: await sendDecisionEmails(payload.profile.smtp, payload.profile.templates, job.title, apps, batch.kind, db),
      });
    }
    return reports;
  });

  handle('export:table', async (payload: {
    kind: 'applications' | 'results' | 'candidates';
    applicationIds?: number[];
    decisions?: [number, string][];
    suggestedName: string;
  }) => {
    if (!win) throw new AppError('AVZ-APP-901', 'export', 'no window');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: payload.suggestedName,
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { saved: false as const };
    if (payload.kind === 'candidates') {
      await exportCandidates(db.listCandidates(), filePath);
    } else {
      const rows = db.getApplications(payload.applicationIds ?? []);
      if (payload.kind === 'results') rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      await exportApplications(rows, new Map(payload.decisions ?? []), filePath, payload.kind === 'results');
    }
    return { saved: true as const, path: filePath };
  });

  handle('candidates:list', () => db.listCandidates());
  handle('candidates:purge', (id: number) => { db.purgeCandidate(id); });

  handle('file:open', async (filePath: string) => {
    const result = await shell.openPath(filePath);
    if (result) throw new AppError('AVZ-PARSE-101', filePath, result);
  });

  handle('dialog:pickFolder', async () => {
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return canceled || !filePaths.length ? null : filePaths[0];
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.setName('AVANZARE');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    logger = new Logger(path.join(userData, 'logs', 'avanzare.log'));
    profiles = new ProfileStore(path.join(userData, 'profiles'));
    db = new Database(path.join(userData, 'avanzare.sqlite'));
    logger.info('app started', { userData });

    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    logger?.close();
    app.quit();
  });
}
