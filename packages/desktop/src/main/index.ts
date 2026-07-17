import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  AppError, Database, Logger, ProfileStore,
  exportApplications, exportAudit, exportCandidates,
  listModels, runLlmAnalysis, runScreening,
  sendDecisionEmails, testConnections,
  type EmailKind, type EmailTemplates, type ScreeningInput, type SettingsProfile, type Tier,
} from '@avanzare/engine';

let win: BrowserWindow | null = null;
let db: Database;
let profiles: ProfileStore;
let logger: Logger;

// ---------- profile secret handling (SMTP password + LLM API key encrypted at rest) ----------

const ENC_PREFIX = 'enc:';

function seal(value: string): string {
  if (value && !value.startsWith(ENC_PREFIX) && safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
  }
  return value;
}

function unseal(value: string): string {
  if (value?.startsWith(ENC_PREFIX) && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
    } catch {
      return '';
    }
  }
  return value;
}

function sealProfile(p: SettingsProfile): SettingsProfile {
  return {
    ...p,
    smtp: { ...p.smtp, pass: seal(p.smtp.pass) },
    llm: { ...p.llm, apiKey: seal(p.llm.apiKey) },
  };
}

function unsealProfile(p: SettingsProfile): SettingsProfile {
  return {
    ...p,
    smtp: { ...p.smtp, pass: unseal(p.smtp.pass) },
    llm: { ...p.llm, apiKey: unseal(p.llm.apiKey) },
  };
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
    /** Per-send template tweaks from the preview modal; falls back to the profile. */
    templatesOverride?: EmailTemplates;
  }) => {
    const job = db.getJob(payload.jobId);
    const templates = payload.templatesOverride ?? payload.profile.templates;
    const reports = [];
    for (const batch of payload.batches) {
      const apps = db.getApplications(batch.applicationIds);
      reports.push({
        kind: batch.kind,
        report: await sendDecisionEmails(payload.profile.smtp, templates, job.title, apps, batch.kind, db),
      });
    }
    return reports;
  });

  handle('contacts:update', (payload: { candidateId: number; name: string; email: string | null; phone: string | null }) => {
    db.updateCandidateContact(payload.candidateId, payload.name, payload.email, payload.phone);
  });

  handle('candidates:addNote', (payload: { candidateIds: number[]; note: string }) => {
    db.appendNote(payload.candidateIds, payload.note);
  });

  handle('candidates:history', (candidateId: number) => db.candidateHistory(candidateId));

  handle('applications:cvText', (applicationId: number) => db.getCvText(applicationId));

  handle('jobs:list', () => db.listJobs());
  handle('jobs:metrics', (jobId: number) => db.jobMetrics(jobId));
  handle('jobs:applications', (jobId: number) => db.listApplications(jobId));

  handle('audit:list', (limit?: number) => db.listAudit(limit ?? 500));

  // The most recent screening, straight from the database — survives tab switches and app restarts.
  handle('job:last', () => {
    const job = db.lastJob();
    if (!job) return null;
    return { job, applications: db.listApplications(job.id) };
  });

  handle('export:table', async (payload: {
    kind: 'applications' | 'results' | 'candidates' | 'audit';
    applicationIds?: number[];
    decisions?: [number, string][];
    suggestedName: string;
    exportDir?: string;
  }) => {
    if (!win) throw new AppError('AVZ-APP-901', 'export', 'no window');
    let defaultPath = payload.suggestedName;
    if (payload.exportDir) {
      if (!fs.existsSync(payload.exportDir) || !fs.statSync(payload.exportDir).isDirectory()) {
        throw new AppError('AVZ-EXP-702', payload.exportDir);
      }
      defaultPath = path.join(payload.exportDir, payload.suggestedName);
    }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { saved: false as const };
    if (payload.kind === 'candidates') {
      await exportCandidates(db.listCandidates(), filePath);
    } else if (payload.kind === 'audit') {
      await exportAudit(db.listAudit(100_000), filePath);
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
