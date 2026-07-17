import fs from 'node:fs';
import path from 'node:path';
import { AppError, asAppError } from '../errors';
import type { SettingsProfile } from '../types';

export const DEFAULT_TEMPLATES = {
  rejectionSubject: 'Your application for {{job_title}}',
  rejectionBody:
    'Dear {{name}},\n\nThank you for your interest in the {{job_title}} position. ' +
    'After careful review we will not be moving forward with your application at this time.\n\n' +
    'We appreciate the time you invested and encourage you to apply for future openings.\n\n' +
    'Best regards',
  acceptanceSubject: 'Next steps for your {{job_title}} application',
  acceptanceBody:
    'Dear {{name}},\n\nThank you for applying for the {{job_title}} position. ' +
    'We were impressed by your profile and would like to invite you to the next stage of the process. ' +
    'We will contact you shortly to arrange the details.\n\n' +
    'Best regards',
};

export function defaultProfile(name = ''): SettingsProfile {
  return {
    name,
    useAutomatically: false,
    source: { kind: 'local', path: '' },
    llm: { baseUrl: 'http://localhost:11434', model: '', timeoutMs: 120_000 },
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', fromAddress: '', fromName: 'Recruiting Team' },
    templates: { ...DEFAULT_TEMPLATES },
    concurrency: 4,
    exportDir: '',
  };
}

/** Throws AVZ-CFG-504 listing every missing/invalid field. */
export function validateProfile(p: SettingsProfile): void {
  const problems: string[] = [];
  if (!p.name.trim()) problems.push('profile name is empty');
  if (p.source.kind === 'local' && !p.source.path.trim()) problems.push('CV source folder is not set');
  if (p.source.kind === 'cloud') problems.push('cloud sources are not yet supported (AVZ-SRC-403)');
  if (!/^https?:\/\//.test(p.llm.baseUrl)) problems.push('LLM base URL must start with http:// or https://');
  if (!p.llm.model.trim()) problems.push('LLM model is not selected');
  if (!p.smtp.host.trim()) problems.push('SMTP host is not set');
  if (!Number.isInteger(p.smtp.port) || p.smtp.port < 1 || p.smtp.port > 65535) problems.push('SMTP port is invalid');
  if (!p.smtp.fromAddress.includes('@')) problems.push('SMTP from-address is invalid');
  if (!Number.isInteger(p.concurrency) || p.concurrency < 1 || p.concurrency > 64) problems.push('concurrency must be 1-64');
  if (problems.length) {
    throw new AppError('AVZ-CFG-504', `profile "${p.name || '(unnamed)'}"`, problems.join('; '));
  }
}

/**
 * Profiles are stored one-per-file as JSON under `dir`.
 * NOTE: SMTP passwords are stored in these files. The desktop app encrypts the
 * `smtp.pass` field with Electron safeStorage before it reaches this store
 * (see desktop/src/main); headless deployments should protect the directory with OS ACLs.
 */
export class ProfileStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private fileFor(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9 _-]/g, '_');
    return path.join(this.dir, `${safe}.profile.json`);
  }

  list(): SettingsProfile[] {
    try {
      return fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.profile.json'))
        .map(f => this.load(path.join(this.dir, f)))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      throw asAppError(err, 'AVZ-CFG-503', this.dir);
    }
  }

  private load(file: string): SettingsProfile {
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      throw asAppError(err, 'AVZ-CFG-501', file);
    }
    try {
      const parsed = JSON.parse(raw) as SettingsProfile;
      // Merge over defaults so profiles saved by older versions gain new fields.
      const base = defaultProfile(parsed.name);
      return {
        ...base,
        ...parsed,
        source: { ...base.source, ...parsed.source },
        llm: { ...base.llm, ...parsed.llm },
        smtp: { ...base.smtp, ...parsed.smtp },
        templates: { ...base.templates, ...parsed.templates },
      };
    } catch (err) {
      throw asAppError(err, 'AVZ-CFG-502', file);
    }
  }

  get(name: string): SettingsProfile {
    const file = this.fileFor(name);
    if (!fs.existsSync(file)) throw new AppError('AVZ-CFG-501', name);
    return this.load(file);
  }

  save(profile: SettingsProfile): void {
    validateProfile(profile);
    try {
      if (profile.useAutomatically) {
        // Only one profile may auto-load.
        for (const other of this.list()) {
          if (other.name !== profile.name && other.useAutomatically) {
            other.useAutomatically = false;
            fs.writeFileSync(this.fileFor(other.name), JSON.stringify(other, null, 2), 'utf-8');
          }
        }
      }
      fs.writeFileSync(this.fileFor(profile.name), JSON.stringify(profile, null, 2), 'utf-8');
    } catch (err) {
      throw asAppError(err, 'AVZ-CFG-503', this.fileFor(profile.name));
    }
  }

  delete(name: string): void {
    try {
      fs.rmSync(this.fileFor(name), { force: true });
    } catch (err) {
      throw asAppError(err, 'AVZ-CFG-503', this.fileFor(name));
    }
  }

  /** The profile marked use-automatically, if any — startup skips the chooser for it. */
  autoProfile(): SettingsProfile | null {
    return this.list().find(p => p.useAutomatically) ?? null;
  }
}
