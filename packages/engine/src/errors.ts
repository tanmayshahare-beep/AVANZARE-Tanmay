/**
 * Central error framework. Every failure in AVANZARE carries a stable code
 * of the form AVZ-<MODULE>-<NNN>. The full catalogue lives in docs/ERROR_CODES.md
 * and must be kept in sync with ERROR_CODES below.
 */

export const ERROR_CODES = {
  // PARSE 1xx — document text extraction
  'AVZ-PARSE-101': 'File could not be read from disk',
  'AVZ-PARSE-102': 'PDF is corrupt or could not be parsed',
  'AVZ-PARSE-103': 'PDF has no extractable text layer (likely a scanned image; OCR not yet enabled)',
  'AVZ-PARSE-104': 'Unsupported file type (only .pdf, .docx, .doc are screened)',
  'AVZ-PARSE-105': 'Document parsed but contained no text',
  'AVZ-PARSE-106': 'Word document could not be parsed',
  'AVZ-PARSE-107': 'OCR failed to read a scanned PDF',

  // LLM 2xx — Ollama analysis
  'AVZ-LLM-201': 'Ollama endpoint unreachable',
  'AVZ-LLM-202': 'Requested model is not available on the Ollama endpoint',
  'AVZ-LLM-203': 'LLM returned a response that could not be parsed as {score, reasoning}',
  'AVZ-LLM-204': 'LLM request timed out',
  'AVZ-LLM-205': 'LLM analysis failed for a candidate',
  'AVZ-LLM-206': 'LLM API authentication failed (check the API key)',
  'AVZ-LLM-207': 'LLM API rate limit exceeded — retry later or lower concurrency',

  // MAIL 3xx — SMTP / notifications
  'AVZ-MAIL-301': 'Could not connect to SMTP server',
  'AVZ-MAIL-302': 'SMTP authentication failed',
  'AVZ-MAIL-303': 'Email send failed',
  'AVZ-MAIL-304': 'Candidate has no email address on record',
  'AVZ-MAIL-305': 'Email template is invalid',

  // SRC 4xx — CV sources (local folder / cloud)
  'AVZ-SRC-401': 'CV source path does not exist or is not accessible',
  'AVZ-SRC-402': 'No CV files (.pdf/.docx/.doc) found at the source',
  'AVZ-SRC-403': 'Cloud source provider is not configured or not yet supported',

  // CFG 5xx — settings profiles
  'AVZ-CFG-501': 'Settings profile not found',
  'AVZ-CFG-502': 'Settings profile file is invalid or corrupt',
  'AVZ-CFG-503': 'Settings profile could not be saved or deleted',
  'AVZ-CFG-504': 'Settings profile failed validation',

  // DB 6xx — local database
  'AVZ-DB-601': 'Database could not be opened',
  'AVZ-DB-602': 'Database schema migration failed',
  'AVZ-DB-603': 'Database query failed',

  // EXP 7xx — exports
  'AVZ-EXP-701': 'Excel export failed',
  'AVZ-EXP-702': 'Configured export folder does not exist or is not writable',

  // APP 9xx — catch-all
  'AVZ-APP-901': 'Unexpected internal error',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Where it happened: a file being parsed, an endpoint URL, a profile name… */
  readonly location: string;
  readonly detail?: string;

  constructor(code: ErrorCode, location: string, detail?: string, cause?: unknown) {
    super(`${code} ${ERROR_CODES[code]} [at: ${location}]${detail ? ` — ${detail}` : ''}`);
    this.name = 'AppError';
    this.code = code;
    this.location = location;
    this.detail = detail;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: ERROR_CODES[this.code],
      location: this.location,
      detail: this.detail ?? null,
    };
  }
}

/** Wrap any thrown value into an AppError without losing an existing code. */
export function asAppError(err: unknown, fallbackCode: ErrorCode, location: string): AppError {
  if (err instanceof AppError) return err;
  const detail = err instanceof Error ? err.message : String(err);
  return new AppError(fallbackCode, location, detail, err);
}
