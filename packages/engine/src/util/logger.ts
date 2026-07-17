import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal structured logger: JSON lines to a file plus console mirroring.
 * Every AppError logged here lands in the file with its code and location,
 * which is what the docs' troubleshooting section points users at.
 */
export class Logger {
  private stream: fs.WriteStream | null = null;

  constructor(private logFile?: string) {
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      this.stream = fs.createWriteStream(logFile, { flags: 'a' });
    }
  }

  private write(level: string, msg: string, extra?: Record<string, unknown>) {
    const entry = { time: new Date().toISOString(), level, msg, ...extra };
    const line = JSON.stringify(entry);
    if (this.stream) this.stream.write(line + '\n');
    // eslint-disable-next-line no-console
    (level === 'error' ? console.error : console.log)(`[${level}] ${msg}`, extra ?? '');
  }

  info(msg: string, extra?: Record<string, unknown>) { this.write('info', msg, extra); }
  warn(msg: string, extra?: Record<string, unknown>) { this.write('warn', msg, extra); }
  error(msg: string, extra?: Record<string, unknown>) { this.write('error', msg, extra); }

  close() { this.stream?.end(); }
}

export const defaultLogger = new Logger();
