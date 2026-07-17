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
  /** Local/self-hosted Ollama, or the Claude API for users with an Anthropic key. */
  provider: 'ollama' | 'anthropic';
  /** Ollama only — e.g. http://localhost:11434 or http://192.168.1.50:11434 */
  baseUrl: string;
  model: string;
  /** Anthropic only — API key from console.anthropic.com. Encrypted at rest by the app. */
  apiKey: string;
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
  /**
   * Default folder for Excel exports (empty = ask every time). Pointing this at
   * a OneDrive/Google Drive synced folder effectively gives cloud upload;
   * direct API upload will arrive with the cloud connectors.
   */
  exportDir: string;
}

/** A mandatory keyword with its recruiter-assigned importance (1-5). */
export interface WeightedKeyword {
  keyword: string;
  importance: number;
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
  /**
   * Weighted mandatory-keyword score out of 5: each matched keyword earns its
   * importance as marks (missing = 0); this is the average across all mandatory
   * keywords. Null on jobs screened before the feature existed.
   */
  keywordScore: number | null;
  /** Internal recruiter notes stored on the candidate. */
  notes: string | null;
  /** How many other jobs this candidate has applied to (cross-job history). */
  priorCount: number;
}

export interface CandidateHistoryEntry {
  applicationId: number;
  jobId: number;
  jobTitle: string;
  jobDate: string;
  tier: Tier;
  status: ApplicationStatus;
  score: number | null;
}

export interface AuditEntry {
  id: number;
  time: string;
  actor: string;
  action: string;
  candidateId: number | null;
  applicationId: number | null;
  detail: string;
}

export interface JobMetrics {
  job: { id: number; title: string; createdAt: string };
  funnel: {
    applied: number;
    keywordRejected: number;
    rescued: number;
    analyzed: number;
    accepted: number;
    rejectedFinal: number;
    pending: number;
  };
  /** For each mandatory keyword: how many keyword-stage rejects were missing it. */
  mandatoryImpact: { keyword: string; missingCount: number }[];
  /** For each optional keyword: average LLM score of analyzed CVs with vs without it. */
  optionalCorrelation: { keyword: string; withCount: number; withAvg: number | null; withoutAvg: number | null }[];
}

export interface ParseFailure {
  file: string;
  code: string;
  message: string;
}

export interface ScreeningInput {
  jobTitle: string;
  prompt: string;
  mandatoryKeywords: WeightedKeyword[];
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
