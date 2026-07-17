import BetterSqlite3 from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { asAppError } from '../errors';
import type {
  ApplicationRow, ApplicationStatus, AuditEntry, CandidateHistoryEntry, JobMetrics, Tier,
} from '../types';

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
`;

/** Columns added after the first release; applied to existing databases on open. */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'candidates', column: 'notes', ddl: "notes TEXT NOT NULL DEFAULT ''" },
  { table: 'applications', column: 'cv_hash', ddl: "cv_hash TEXT NOT NULL DEFAULT ''" },
];

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

const APP_SELECT = `
  SELECT a.*, c.name, c.email, c.phone, c.notes,
    (SELECT COUNT(*) FROM applications a2
      WHERE a2.candidate_id = a.candidate_id AND a2.job_id != a.job_id) AS prior_count
  FROM applications a
  JOIN candidates c ON c.id = a.candidate_id`;

export class Database {
  readonly db: BetterSqlite3.Database;
  private readonly actor = os.userInfo().username;

  constructor(dbPath: string) {
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
  }

  close() { this.db.close(); }

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
    const tx = this.db.transaction(() => {
      const apps = this.db.prepare('SELECT id FROM applications WHERE candidate_id = ?').all(candidateId) as { id: number }[];
      for (const a of apps) this.db.prepare('DELETE FROM email_log WHERE application_id = ?').run(a.id);
      this.db.prepare('DELETE FROM applications WHERE candidate_id = ?').run(candidateId);
      this.db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);
      // The audit row records the purge itself; personal detail is not repeated.
      this.audit('candidate_purged', `candidate ${candidateId} and ${apps.length} application(s) erased`, candidateId);
    });
    try { tx(); } catch (err) {
      throw asAppError(err, 'AVZ-DB-603', `purgeCandidate(${candidateId})`);
    }
  }

  // ---- jobs & applications ----

  createJob(title: string, prompt: string, mandatory: string[], optional: string[]): number {
    const res = this.db.prepare(
      'INSERT INTO jobs (title, prompt, mandatory_keywords, optional_keywords, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(title, prompt, JSON.stringify(mandatory), JSON.stringify(optional), new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  listJobs(): { id: number; title: string; createdAt: string }[] {
    const rows = this.db.prepare('SELECT id, title, created_at FROM jobs ORDER BY id DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({ id: r.id as number, title: r.title as string, createdAt: r.created_at as string }));
  }

  lastJob(): { id: number; title: string; createdAt: string } | null {
    return this.listJobs()[0] ?? null;
  }

  getJob(jobId: number): { id: number; title: string; prompt: string; mandatory: string[]; optional: string[]; createdAt: string } {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
    if (!r) throw asAppError(new Error(`job ${jobId} not found`), 'AVZ-DB-603', `getJob(${jobId})`);
    return {
      id: r.id as number,
      title: r.title as string,
      prompt: r.prompt as string,
      mandatory: JSON.parse(r.mandatory_keywords as string),
      optional: JSON.parse(r.optional_keywords as string),
      createdAt: r.created_at as string,
    };
  }

  insertApplication(
    jobId: number, candidateId: number, cvPath: string, cvText: string, cvHash: string, tier: Tier,
    matchedMandatory: string[], matchedOptional: string[],
  ): number {
    try {
      const res = this.db.prepare(
        `INSERT INTO applications (job_id, candidate_id, cv_path, cv_text, cv_hash, tier, matched_mandatory, matched_optional)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id, candidate_id) DO UPDATE SET
           cv_path = excluded.cv_path, cv_text = excluded.cv_text, cv_hash = excluded.cv_hash, tier = excluded.tier,
           matched_mandatory = excluded.matched_mandatory, matched_optional = excluded.matched_optional`,
      ).run(jobId, candidateId, cvPath, cvText, cvHash, tier, JSON.stringify(matchedMandatory), JSON.stringify(matchedOptional));
      if (res.lastInsertRowid && res.changes === 1) return Number(res.lastInsertRowid);
      const row = this.db.prepare('SELECT id FROM applications WHERE job_id = ? AND candidate_id = ?').get(jobId, candidateId) as { id: number };
      return row.id;
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

  setVerdict(applicationId: number, score: number, reasoning: string): void {
    this.db.prepare('UPDATE applications SET score = ?, reasoning = ? WHERE id = ?').run(score, reasoning, applicationId);
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

    const mandatoryImpact = job.mandatory.map(keyword => ({
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
