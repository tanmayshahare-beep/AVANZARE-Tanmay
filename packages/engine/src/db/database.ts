import BetterSqlite3 from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { asAppError } from '../errors';
import type { ApplicationRow, ApplicationStatus, Tier } from '../types';

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
  reasoning TEXT,
  UNIQUE(job_id, candidate_id)
);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  kind TEXT NOT NULL,
  recipient TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  sent_at TEXT NOT NULL
);
`;

export interface CandidateRecord {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  lastCvPath: string | null;
  firstSeen: string;
  lastSeen: string;
}

export class Database {
  readonly db: BetterSqlite3.Database;

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
    } catch (err) {
      throw asAppError(err, 'AVZ-DB-602', dbPath);
    }
  }

  close() { this.db.close(); }

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

  listCandidates(): CandidateRecord[] {
    const rows = this.db.prepare('SELECT * FROM candidates ORDER BY last_seen DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as number,
      name: r.name as string,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
      lastCvPath: (r.last_cv_path as string) ?? null,
      firstSeen: r.first_seen as string,
      lastSeen: r.last_seen as string,
    }));
  }

  /** GDPR erasure: removes the candidate and their applications/email log entries. */
  purgeCandidate(candidateId: number): void {
    const tx = this.db.transaction(() => {
      const apps = this.db.prepare('SELECT id FROM applications WHERE candidate_id = ?').all(candidateId) as { id: number }[];
      for (const a of apps) this.db.prepare('DELETE FROM email_log WHERE application_id = ?').run(a.id);
      this.db.prepare('DELETE FROM applications WHERE candidate_id = ?').run(candidateId);
      this.db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);
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

  /** Most recent screening job, or null if none exist yet. Backs the persistent Results tab. */
  lastJob(): { id: number; title: string; createdAt: string } | null {
    const r = this.db.prepare('SELECT id, title, created_at FROM jobs ORDER BY id DESC LIMIT 1').get() as
      Record<string, unknown> | undefined;
    return r ? { id: r.id as number, title: r.title as string, createdAt: r.created_at as string } : null;
  }

  getJob(jobId: number): { id: number; title: string; prompt: string; mandatory: string[]; optional: string[] } {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
    if (!r) throw asAppError(new Error(`job ${jobId} not found`), 'AVZ-DB-603', `getJob(${jobId})`);
    return {
      id: r.id as number,
      title: r.title as string,
      prompt: r.prompt as string,
      mandatory: JSON.parse(r.mandatory_keywords as string),
      optional: JSON.parse(r.optional_keywords as string),
    };
  }

  insertApplication(
    jobId: number, candidateId: number, cvPath: string, cvText: string, tier: Tier,
    matchedMandatory: string[], matchedOptional: string[],
  ): number {
    try {
      const res = this.db.prepare(
        `INSERT INTO applications (job_id, candidate_id, cv_path, cv_text, tier, matched_mandatory, matched_optional)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id, candidate_id) DO UPDATE SET
           cv_path = excluded.cv_path, cv_text = excluded.cv_text, tier = excluded.tier,
           matched_mandatory = excluded.matched_mandatory, matched_optional = excluded.matched_optional`,
      ).run(jobId, candidateId, cvPath, cvText, tier, JSON.stringify(matchedMandatory), JSON.stringify(matchedOptional));
      if (res.lastInsertRowid && res.changes === 1) return Number(res.lastInsertRowid);
      const row = this.db.prepare('SELECT id FROM applications WHERE job_id = ? AND candidate_id = ?').get(jobId, candidateId) as { id: number };
      return row.id;
    } catch (err) {
      throw asAppError(err, 'AVZ-DB-603', `insertApplication(job ${jobId}, candidate ${candidateId})`);
    }
  }

  listApplications(jobId: number, tiers?: Tier[]): ApplicationRow[] {
    let sql = `
      SELECT a.*, c.name, c.email, c.phone FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      WHERE a.job_id = ?`;
    if (tiers && tiers.length) sql += ` AND a.tier IN (${tiers.map(() => '?').join(',')})`;
    const rows = this.db.prepare(sql).all(jobId, ...(tiers ?? [])) as Record<string, unknown>[];
    return rows.map(r => ({
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
    }));
  }

  getApplications(ids: number[]): ApplicationRow[] {
    if (!ids.length) return [];
    const sql = `
      SELECT a.*, c.name, c.email, c.phone FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      WHERE a.id IN (${ids.map(() => '?').join(',')})`;
    const rows = this.db.prepare(sql).all(...ids) as Record<string, unknown>[];
    return rows.map(r => ({
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
    }));
  }

  getCvText(applicationId: number): string {
    const row = this.db.prepare('SELECT cv_text FROM applications WHERE id = ?').get(applicationId) as { cv_text: string } | undefined;
    return row?.cv_text ?? '';
  }

  setApplicationStatus(applicationId: number, status: ApplicationStatus): void {
    this.db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, applicationId);
  }

  setApplicationTier(applicationId: number, tier: Tier): void {
    this.db.prepare('UPDATE applications SET tier = ? WHERE id = ?').run(tier, applicationId);
  }

  setVerdict(applicationId: number, score: number, reasoning: string): void {
    this.db.prepare('UPDATE applications SET score = ?, reasoning = ? WHERE id = ?').run(score, reasoning, applicationId);
  }

  logEmail(applicationId: number | null, kind: string, recipient: string | null, status: string, errorCode?: string): void {
    this.db.prepare(
      'INSERT INTO email_log (application_id, kind, recipient, status, error_code, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(applicationId, kind, recipient, status, errorCode ?? null, new Date().toISOString());
  }
}
