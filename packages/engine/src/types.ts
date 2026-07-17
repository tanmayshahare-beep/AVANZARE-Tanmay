/** Shared engine types. These cross the IPC boundary to the UI, so keep them JSON-safe. */

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
  fromName: string;
}

export interface LlmSettings {
  /** e.g. http://localhost:11434 or http://192.168.1.50:11434 */
  baseUrl: string;
  model: string;
  /** Per-request timeout in ms. */
  timeoutMs: number;
}

export interface SourceSettings {
  kind: 'local' | 'cloud';
  /** Local: absolute folder path. Cloud: reserved for connector config. */
  path: string;
  provider?: 'gdrive' | 'onedrive' | 's3';
}

export interface EmailTemplates {
  /** {{name}} and {{job_title}} placeholders are substituted. */
  rejectionSubject: string;
  rejectionBody: string;
  acceptanceSubject: string;
  acceptanceBody: string;
}

export interface SettingsProfile {
  name: string;
  useAutomatically: boolean;
  source: SourceSettings;
  llm: LlmSettings;
  smtp: SmtpSettings;
  templates: EmailTemplates;
  /** Max CVs parsed/analyzed concurrently — keeps shared servers polite. */
  concurrency: number;
}

export type Tier = 'rejected' | 'mandatory' | 'optional' | 'rescued';

export type ApplicationStatus =
  | 'pending'            // parsed, awaiting recruiter decisions
  | 'rejected_notified'  // rejection email sent (or attempted)
  | 'in_llm'             // forwarded to LLM analysis
  | 'accepted'           // acceptance email sent
  | 'rejected_final';    // rejected after LLM stage

export interface ApplicationRow {
  id: number;
  jobId: number;
  candidateId: number;
  name: string;
  email: string | null;
  phone: string | null;
  cvPath: string;
  tier: Tier;
  matchedMandatory: string[];
  matchedOptional: string[];
  status: ApplicationStatus;
  score: number | null;
  reasoning: string | null;
}

export interface ParseFailure {
  file: string;
  code: string;
  message: string;
}

export interface ScreeningInput {
  jobTitle: string;
  prompt: string;
  mandatoryKeywords: string[];
  optionalKeywords: string[];
  sourcePath: string;
  concurrency: number;
}

export interface ScreeningResult {
  jobId: number;
  rejected: ApplicationRow[];
  acceptedMandatory: ApplicationRow[];
  acceptedOptional: ApplicationRow[];
  failures: ParseFailure[];
}

export interface ScreeningProgress {
  phase: 'scanning' | 'parsing' | 'analyzing';
  done: number;
  total: number;
  currentFile?: string;
}

export interface LlmVerdict {
  applicationId: number;
  score: number;
  reasoning: string;
}

export interface ConnectionTestResult {
  target: 'source' | 'llm' | 'smtp';
  ok: boolean;
  message: string;
  errorCode?: string;
}

export interface EmailSendReport {
  sent: number;
  failed: { applicationId: number; name: string; code: string; message: string }[];
  noEmail: { applicationId: number; name: string }[];
}
