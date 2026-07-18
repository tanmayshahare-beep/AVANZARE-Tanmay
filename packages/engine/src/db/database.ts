import BetterSqlite3 from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { asAppError } from '../errors';
import type {
  ApplicationRow, ApplicationStatus, AuditEntry, CandidateHistoryEntry, CriteriaVerdict, EducationVerdict,
  JobCriteria, JobMetrics, KeywordSynonym, Tier, WeightedKeyword,
} from '../types';
import { EMPTY_CRITERIA } from '../types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  last_cv_path TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mandatory_keywords TEXT NOT NULL,
  optional_keywords TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  cv_path TEXT NOT NULL,
  cv_text TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL,
  matched_mandatory TEXT NOT NULL DEFAULT '[]',
  matched_optional TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  score REAL,
  reasoning TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_job_candidate ON applications(job_id, candidate_id);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  kind TEXT NOT NULL,
  recipient TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  sent_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  candidate_id INTEGER,
  application_id INTEGER,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS imported_emails (
  message_id TEXT PRIMARY KEY,
  mailbox TEXT,
  imported_at TEXT NOT NULL
);
`;

/** Columns added after the first release; applied to existing databases on open. */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'candidates', column: 'notes', ddl: "notes TEXT NOT NULL DEFAULT ''" },
  { table: 'applications', column: 'cv_hash', ddl: "cv_hash TEXT NOT NULL DEFAULT ''" },
  { table: 'applications', column: 'keyword_score', ddl: 'keyword_score REAL' },
  { table: 'jobs', column: 'criteria', ddl: "criteria TEXT NOT NULL DEFAULT ''" },
  { table: 'applications', column: 'criteria_json', ddl: 'criteria_json TEXT' },
  { table: 'applications', column: 'education_json', ddl: 'education_json TEXT' },
  { table: 'jobs', column: 'target_acceptances', ddl: 'target_acceptances INTEGER' },
  { table: 'jobs', column: 'keyword_synonyms', ddl: "keyword_synonyms TEXT NOT NULL DEFAULT '[]'" },
];

/** Jobs saved before weighted keywords stored plain strings — normalize to importance 3. */
function normalizeMandatory(parsed: unknown[]): WeightedKeyword[] {
  return parsed.map(k =>
    typeof k === 'string'
      ? { keyword: k, importance: 3 }
      : k as WeightedKeyword,
  );
}

export interface CandidateRecord {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  lastCvPath: string | null;
  firstSeen: string;
  lastSeen: string;
  notes: string;
  applicationCount: number;
}

/** A talent-pool search result: a candidate plus a snippet of the matching CV text. */
export interface CandidateSearchHit {
  candidateId: number;
  name: string;
  email: string | null;
  phone: string | null;
  lastCvPath: string | null;
  lastSeen: string;
  applicationCount: number;
  /** Excerpt of the matched CV text with the hit marked, or '' on the LIKE fallback. */
  snippet: string;
}

const APP_SELECT = `
  SELECT a.*, c.name, c.email, c.phone, c.notes,
    (SELECT COUNT(*) FROM applications a2
      WHERE a2.candidate_id = a.candidate_id AND a2.job_id != a.job_id) AS prior_count
  FROM applications a
  JOIN candidates c ON c.id = a.candidate_id`;

export class Database {
  readonly db: BetterSqlite3.Database;
  private readonly actor = os.userInfo().username;
  /** Whether the FTS5 talent-pool index is usable; false → search degrades to LIKE. */
  private ftsReady = false;
  /**
   * Folder holding app-created CV copies (downloaded from email sources). CVs whose
   * path is inside it are the app's own copies, so purging a candidate deletes them;
   * local-folder CVs (outside it) are the recruiter's files and are left untouched.
   */
  private readonly managedCvDir: string | null;

  constructor(dbPath: string, managedCvDir?: string) {
    this.managedCvDir = managedCvDir ? path.resolve(managedCvDir) : null;
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      this.db = new BetterSqlite3(dbPath);
      this.db.pragma('journal_mode = WAL');
    } catch (err) {
      throw asAppError(err, 'AVZ-DB-601', dbPath);
    }
    try {
      this.db.exec(SCHEMA);
      for (const m of MIGRATIONS) {
        const cols = this.db.pragma(`table_info(${m.table})`) as { name: string }[];
        if (!cols.some(c => c.name === m.column)) {
          this.db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.ddl}`);
        }
      }
    } catch (err) {
      throw asAppError(err, 'AVZ-DB-602', dbPath);
    }
    this.initSearchIndex();
  }

  close() { this.db.close(); }

  // ---- email-source import dedup ----

  /** Message-ids already imported from an email source, so re-runs never duplicate them. */
  importedMessageIds(): Set<string> {
    const rows = this.db.prepare('SELECT message_id FROM imported_emails').all() as { message_id: string }[];
    return new Set(rows.map(r => r.message_id));
  }

  recordImportedMessages(messageIds: string[], mailbox: string): void {
    const now = new Date().toISOString();
    const ins = this.db.prepare('INSERT OR IGNORE INTO imported_emails (message_id, mailbox, imported_at) VALUES (?, ?, ?)');
    this.db.transaction(() => { for (const id of messageIds) ins.run(id, mailbox, now); })();
  }

  // ---- talent-pool full-text search (FTS5) ----

  /**
   * Build the FTS5 index over candidate name + CV text. FTS5 is compiled into the
   * standard SQLite build, but if it's ever missing this degrades gracefully to a
   * LIKE scan (ftsReady stays false) rather than breaking the app.
   */
  private initSearchIndex(): void {
    try {
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS app_fts USING fts5(name, cv_text, tokenize='porter unicode61')");
      const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM app_fts').get() as { n: number };
      if (n === 0) {
        // First run after upgrade: backfill from existing applications.
        const rows = this.db.prepare(
          'SELECT a.id AS id, c.name AS name, a.cv_text AS cv_text FROM applications a JOIN candidates c ON c.id = a.candidate_id',
        ).all() as { id: number; name: string; cv_text: string }[];
        const ins = this.db.prepare('INSERT INTO app_fts (rowid, name, cv_text) VALUES (?, ?, ?)');
        this.db.transaction(() => { for (const r of rows) ins.run(r.id, r.name ?? '', r.cv_text ?? ''); })();
      }
      this.ftsReady = true;
    } catch {
      this.ftsReady = false;
    }
  }

  /** Keep the FTS row for one application in sync (called on insert/update). */
  private indexApplication(appId: number, cvText: string): void {
    if (!this.ftsReady) return;
    try {
      const c = this.db.prepare(
        'SELECT c.name AS name FROM applications a JOIN candidates c ON c.id = a.candidate_id WHERE a.id = ?',
      ).get(appId) as { name: string } | undefined;
      this.db.prepare('DELETE FROM app_fts WHERE rowid = ?').run(appId);
      this.db.prepare('INSERT INTO app_fts (rowid, name, cv_text) VALUES (?, ?, ?)').run(appId, c?.name ?? '', cvText);
    } catch { /* indexing is best-effort; never fail a screening because of it */ }
  }

  /** Turn free user input into a safe FTS5 MATCH expression (AND of quoted terms). */
  private ftsQuery(q: string): string {
    return q.replace(/["*():^-]/g, ' ').trim().split(/\s+/).filter(Boolean).map(t => `"${t}"`).join(' ');
  }

  /**
   * Search the whole talent pool by CV content and name. Returns one hit per
   * candidate (their best-ranked match), most relevant first.
   */
  searchCandidates(query: string, limit = 60): CandidateSearchHit[] {
    const q = query.trim();
    if (!q) return [];
    try {
      const match = this.ftsQuery(q);
      if (this.ftsReady && match) {
        const rows = this.db.prepare(
          `SELECT a.candidate_id AS cid, snippet(app_fts, 1, '⟪', '⟫', '…', 12) AS snip
           FROM app_fts JOIN applications a ON a.id = app_fts.rowid
           WHERE app_fts MATCH ? ORDER BY rank LIMIT 500`,
        ).all(match) as { cid: number; snip: string }[];
        return this.collectHits(rows.map(r => ({ candidateId: r.cid, snippet: r.snip })), limit);
      }
    } catch { /* malformed MATCH etc. → fall through to LIKE */ }

    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    const rows = this.db.prepare(
      `SELECT DISTINCT a.candidate_id AS cid FROM applications a JOIN candidates c ON c.id = a.candidate_id
       WHERE a.cv_text LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\' LIMIT ?`,
    ).all(like, like, like, limit * 3) as { cid: number }[];
    return this.collectHits(rows.map(r => ({ candidateId: r.cid, snippet: '' })), limit);
  }

  private collectHits(raw: { candidateId: number; snippet: string }[], limit: number): CandidateSearchHit[] {
    const seen = new Map<number, string>();
    for (const r of raw) {
      if (!seen.has(r.candidateId)) seen.set(r.candidateId, r.snippet);
      if (seen.size >= limit) break;
    }
    const hits: CandidateSearchHit[] = [];
    for (const [cid, snippet] of seen) {
      const c = this.db.prepare(
        'SELECT c.*, (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = c.id) AS app_count FROM candidates c WHERE c.id = ?',
      ).get(cid) as Record<string, unknown> | undefined;
      if (!c) continue;
      hits.push({
        candidateId: cid,
        name: c.name as string,
        email: (c.email as string) ?? null,
        phone: (c.phone as string) ?? null,
        lastCvPath: (c.last_cv_path as string) ?? null,
        lastSeen: c.last_seen as string,
        applicationCount: c.app_count as number,
        snippet,
      });
    }
    return hits;
  }

  // ---- audit trail ----

  /** Every consequential action lands here: who (OS user), what, when, about whom. */
  audit(action: string, detail: string, candidateId?: number | null, applicationId?: number | null): void {
    this.db.prepare(
      'INSERT INTO audit_log (time, actor, action, candidate_id, application_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(new Date().toISOString(), this.actor, action, candidateId ?? null, applicationId ?? null, detail);
  }

  listAudit(limit = 500): AuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as number,
      time: r.time as string,
      actor: r.actor as string,
      action: r.action as string,
      candidateId: (r.candidate_id as number) ?? null,
      applicationId: (r.application_id as number) ?? null,
      detail: r.detail as string,
    }));
  }

  // ---- candidates (persistent talent DB, deduped by email) ----

  upsertCandidate(name: string, email: string | null, phone: string | null, cvPath: string): number {
    const now = new Date().toISOString();
    try {
      if (email) {
        const existing = this.db.prepare('SELECT id FROM candidates WHERE email = ?').get(email) as { id: number } | undefined;
        if (existing) {
          this.db.prepare(
            'UPDATE candidates SET name = ?, phone = COALESCE(?, phone), last_cv_path = ?, last_seen = ? WHERE id = ?',
          ).run(name, phone, cvPath, now, existing.id);
          return existing.id;
        }
      }
      const res = this.db.prepare(
        'INSERT INTO candidates (name, email, phone, last_cv_path, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(name, email, phone, cvPath, now, now);
      return Number(res.lastInsertRowid);
    } catch (err) {
      throw asAppError(err, 'AVZ-DB-603', `upsertCandidate(${email ?? name})`);
    }
  }

  /** Inline contact correction from the UI — audited, since it rewrites personal data. */
  updateCandidateContact(candidateId: number, name: string, email: string | null, phone: string | null): void {
    try {
      const before = this.db.prepare('SELECT name, email, phone FROM candidates WHERE id = ?').get(candidateId);
      this.db.prepare('UPDATE candidates SET name = ?, email = ?, phone = ? WHERE id = ?')
        .run(name, email, phone, candidateId);
      // Keep the search index's name column current for this candidate's applications.
      if (this.ftsReady) {
        const apps = this.db.prepare('SELECT id, cv_text FROM applications WHERE candidate_id = ?')
          .all(candidateId) as { id: number; cv_text: string }[];
        for (const a of apps) this.indexApplication(a.id, a.cv_text);
      }
      this.audit('contact_edit', `from ${JSON.stringify(before)} to ${JSON.stringify({ name, email, phone })}`, candidateId);
    } catch (err) {
      throw asAppError(err, 'AVZ-DB-603', `updateCandidateContact(${candidateId})`);
    }
  }

  /** Bulk internal note: appended (timestamped) to each selected candidate. */
  appendNote(candidateIds: number[], note: string): void {
    const stamp = new Date().toISOString().slice(0, 10);
    const line = `[${stamp}] ${note.trim()}`;
    const tx = this.db.transaction(() => {
      for (const id of candidateIds) {
        this.db.prepare(
          "UPDATE candidates SET notes = CASE WHEN notes = '' THEN ? ELSE notes || char(10) || ? END WHERE id = ?",
        ).run(line, line, id);
        this.audit('note_add', line, id);
      }
    });
    try { tx(); } catch (err) {
      throw asAppError(err, 'AVZ-DB-603', `appendNote(${candidateIds.length} candidates)`);
    }
  }

  listCandidates(): CandidateRecord[] {
    const rows = this.db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = c.id) AS app_count
      FROM candidates c ORDER BY c.last_seen DESC`).all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as number,
      name: r.name as string,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
      lastCvPath: (r.last_cv_path as string) ?? null,
      firstSeen: r.first_seen as string,
      lastSeen: r.last_seen as string,
      notes: (r.notes as string) ?? '',
      applicationCount: r.app_count as number,
    }));
  }

  /** Cross-job history of one candidate: every application with job, outcome, score. */
  candidateHistory(candidateId: number): CandidateHistoryEntry[] {
    const rows = this.db.prepare(`
      SELECT a.id AS app_id, a.tier, a.status, a.score, j.id AS job_id, j.title, j.created_at
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.candidate_id = ? ORDER BY a.id DESC`).all(candidateId) as Record<string, unknown>[];
    return rows.map(r => ({
      applicationId: r.app_id as number,
      jobId: r.job_id as number,
      jobTitle: r.title as string,
      jobDate: r.created_at as string,
      tier: r.tier as Tier,
      status: r.status as ApplicationStatus,
      score: (r.score as number) ?? null,
    }));
  }

  /** GDPR erasure: removes the candidate and their applications/email log entries. */
  purgeCandidate(candidateId: number): void {
    const managedFiles: string[] = [];
    const tx = this.db.transaction(() => {
      const apps = this.db.prepare('SELECT id, cv_path FROM applications WHERE candidate_id = ?')
        .all(candidateId) as { id: number; cv_path: string }[];
      for (const a of apps) {
        this.db.prepare('DELETE FROM email_log WHERE application_id = ?').run(a.id);
        // GDPR: the erased candidate's CV text must not linger in the search index.
        if (this.ftsReady) { try { this.db.prepare('DELETE FROM app_fts WHERE rowid = ?').run(a.id); } catch { /* best-effort */ } }
        if (this.isManagedCv(a.cv_path)) managedFiles.push(a.cv_path);
      }
      this.db.prepare('DELETE FROM applications WHERE candidate_id = ?').run(candidateId);
      this.db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);
      // The audit row records the purge itself; personal detail is not repeated.
      this.audit('candidate_purged', `candidate ${candidateId} and ${apps.length} application(s) erased`, candidateId);
    });
    try { tx(); } catch (err) {
      throw asAppError(err, 'AVZ-DB-603', `purgeCandidate(${candidateId})`);
    }
    // Delete the app's own CV copies (email downloads) after the DB commit — best-effort.
    for (const f of managedFiles) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
  }

  /** True if a CV path is an app-created copy under the managed download dir. */
  private isManagedCv(cvPath: string): boolean {
    if (!this.managedCvDir || !cvPath) return false;
    const resolved = path.resolve(cvPath);
    return resolved === this.managedCvDir || resolved.startsWith(this.managedCvDir + path.sep);
  }

  // ---- jobs & applications ----

  createJob(
    title: string, prompt: string, mandatory: WeightedKeyword[], optional: string[],
    synonyms: KeywordSynonym[], criteria: JobCriteria, targetAcceptances: number | null,
  ): number {
    const res = this.db.prepare(
      `INSERT INTO jobs (title, prompt, mandatory_keywords, optional_keywords, keyword_synonyms, criteria, target_acceptances, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(title, prompt, JSON.stringify(mandatory), JSON.stringify(optional), JSON.stringify(synonyms),
      JSON.stringify(criteria), targetAcceptances, new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  listJobs(): { id: number; title: string; createdAt: string }[] {
    const rows = this.db.prepare('SELECT id, title, created_at FROM jobs ORDER BY id DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({ id: r.id as number, title: r.title as string, createdAt: r.created_at as string }));
  }

  lastJob(): { id: number; title: string; createdAt: string } | null {
    return this.listJobs()[0] ?? null;
  }

  getJob(jobId: number): {
    id: number; title: string; prompt: string;
    mandatory: WeightedKeyword[]; optional: string[]; synonyms: KeywordSynonym[]; criteria: JobCriteria;
    targetAcceptances: number | null; createdAt: string;
  } {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
    if (!r) throw asAppError(new Error(`job ${jobId} not found`), 'AVZ-DB-603', `getJob(${jobId})`);
    let criteria: JobCriteria = { ...EMPTY_CRITERIA };
    const rawCriteria = r.criteria as string | undefined;
    if (rawCriteria) {
      try { criteria = { ...EMPTY_CRITERIA, ...JSON.parse(rawCriteria) }; } catch { /* legacy/corrupt → empty */ }
    }
    return {
      id: r.id as number,
      title: r.title as string,
      prompt: r.prompt as string,
      mandatory: normalizeMandatory(JSON.parse(r.mandatory_keywords as string)),
      optional: JSON.parse(r.optional_keywords as string),
      synonyms: r.keyword_synonyms ? JSON.parse(r.keyword_synonyms as string) as KeywordSynonym[] : [],
      criteria,
      targetAcceptances: (r.target_acceptances as number) ?? null,
      createdAt: r.created_at as string,
    };
  }

  insertApplication(
    jobId: number, candidateId: number, cvPath: string, cvText: string, cvHash: string, tier: Tier,
    matchedMandatory: string[], matchedOptional: string[], keywordScore: number,
  ): number {
    try {
      const res = this.db.prepare(
        `INSERT INTO applications (job_id, candidate_id, cv_path, cv_text, cv_hash, tier, matched_mandatory, matched_optional, keyword_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id, candidate_id) DO UPDATE SET
           cv_path = excluded.cv_path, cv_text = excluded.cv_text, cv_hash = excluded.cv_hash, tier = excluded.tier,
           matched_mandatory = excluded.matched_mandatory, matched_optional = excluded.matched_optional,
           keyword_score = excluded.keyword_score`,
      ).run(jobId, candidateId, cvPath, cvText, cvHash, tier, JSON.stringify(matchedMandatory), JSON.stringify(matchedOptional), keywordScore);
      const appId = res.lastInsertRowid && res.changes === 1
        ? Number(res.lastInsertRowid)
        : (this.db.prepare('SELECT id FROM applications WHERE job_id = ? AND candidate_id = ?').get(jobId, candidateId) as { id: number }).id;
      this.indexApplication(appId, cvText);
      return appId;
    } catch (err) {
      throw asAppError(err, 'AVZ-DB-603', `insertApplication(job ${jobId}, candidate ${candidateId})`);
    }
  }

  private mapApplication(r: Record<string, unknown>): ApplicationRow {
    return {
      id: r.id as number,
      jobId: r.job_id as number,
      candidateId: r.candidate_id as number,
      name: r.name as string,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
      cvPath: r.cv_path as string,
      tier: r.tier as Tier,
      matchedMandatory: JSON.parse(r.matched_mandatory as string),
      matchedOptional: JSON.parse(r.matched_optional as string),
      status: r.status as ApplicationStatus,
      score: (r.score as number) ?? null,
      reasoning: (r.reasoning as string) ?? null,
      keywordScore: (r.keyword_score as number) ?? null,
      criteria: r.criteria_json ? JSON.parse(r.criteria_json as string) as CriteriaVerdict : null,
      education: r.education_json ? JSON.parse(r.education_json as string) as EducationVerdict : null,
      notes: ((r.notes as string) || null),
      priorCount: (r.prior_count as number) ?? 0,
    };
  }

  listApplications(jobId: number, tiers?: Tier[]): ApplicationRow[] {
    let sql = `${APP_SELECT} WHERE a.job_id = ?`;
    if (tiers && tiers.length) sql += ` AND a.tier IN (${tiers.map(() => '?').join(',')})`;
    const rows = this.db.prepare(sql).all(jobId, ...(tiers ?? [])) as Record<string, unknown>[];
    return rows.map(r => this.mapApplication(r));
  }

  getApplications(ids: number[]): ApplicationRow[] {
    if (!ids.length) return [];
    const sql = `${APP_SELECT} WHERE a.id IN (${ids.map(() => '?').join(',')})`;
    const rows = this.db.prepare(sql).all(...ids) as Record<string, unknown>[];
    return rows.map(r => this.mapApplication(r));
  }

  getCvText(applicationId: number): string {
    const row = this.db.prepare('SELECT cv_text FROM applications WHERE id = ?').get(applicationId) as { cv_text: string } | undefined;
    return row?.cv_text ?? '';
  }

  getCvInfo(applicationId: number): { path: string; hash: string } {
    const row = this.db.prepare('SELECT cv_path, cv_hash FROM applications WHERE id = ?').get(applicationId) as
      { cv_path: string; cv_hash: string } | undefined;
    return { path: row?.cv_path ?? '', hash: row?.cv_hash ?? '' };
  }

  setApplicationStatus(applicationId: number, status: ApplicationStatus): void {
    this.db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, applicationId);
  }

  setApplicationTier(applicationId: number, tier: Tier): void {
    this.db.prepare('UPDATE applications SET tier = ? WHERE id = ?').run(tier, applicationId);
    this.audit('tier_change', `application ${applicationId} → ${tier}`, null, applicationId);
  }

  setVerdict(
    applicationId: number, score: number, reasoning: string,
    criteria: CriteriaVerdict | null = null, education: EducationVerdict | null = null,
  ): void {
    this.db.prepare('UPDATE applications SET score = ?, reasoning = ?, criteria_json = ?, education_json = ? WHERE id = ?')
      .run(score, reasoning, criteria ? JSON.stringify(criteria) : null,
        education ? JSON.stringify(education) : null, applicationId);
  }

  logEmail(applicationId: number | null, kind: string, recipient: string | null, status: string, errorCode?: string): void {
    this.db.prepare(
      'INSERT INTO email_log (application_id, kind, recipient, status, error_code, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(applicationId, kind, recipient, status, errorCode ?? null, new Date().toISOString());
  }

  // ---- job performance metrics ----

  jobMetrics(jobId: number): JobMetrics {
    const job = this.getJob(jobId);
    const apps = this.listApplications(jobId);

    const keywordRejects = apps.filter(a => a.tier === 'rejected' || a.tier === 'rescued');
    const analyzed = apps.filter(a => a.score !== null);

    const mandatoryImpact = job.mandatory.map(({ keyword }) => ({
      keyword,
      missingCount: keywordRejects.filter(a => !a.matchedMandatory.includes(keyword)).length,
    })).sort((a, b) => b.missingCount - a.missingCount);

    const avg = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
    const optionalCorrelation = job.optional.map(keyword => {
      const withKw = analyzed.filter(a => a.matchedOptional.includes(keyword)).map(a => a.score as number);
      const withoutKw = analyzed.filter(a => !a.matchedOptional.includes(keyword)).map(a => a.score as number);
      return { keyword, withCount: withKw.length, withAvg: avg(withKw), withoutAvg: avg(withoutKw) };
    }).sort((a, b) => (b.withAvg ?? -1) - (a.withAvg ?? -1));

    return {
      job: { id: job.id, title: job.title, createdAt: job.createdAt },
      funnel: {
        applied: apps.length,
        keywordRejected: keywordRejects.length,
        rescued: apps.filter(a => a.tier === 'rescued').length,
        analyzed: analyzed.length,
        accepted: apps.filter(a => a.status === 'accepted').length,
        rejectedFinal: apps.filter(a => a.status === 'rejected_notified' || a.status === 'rejected_final').length,
        pending: apps.filter(a => a.status === 'pending' || a.status === 'in_llm').length,
      },
      mandatoryImpact,
      optionalCorrelation,
    };
  }
}
