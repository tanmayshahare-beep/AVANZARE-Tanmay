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

/** IMAP mailbox to pull application emails from (a dedicated hiring inbox or label). */
export interface ImapSettings {
  host: string;
  port: number;
  /** true = implicit TLS (usually port 993). */
  secure: boolean;
  user: string;
  /** App password (encrypted at rest by the desktop app, like the SMTP password). */
  pass: string;
  /** Mailbox / Gmail label to read from, e.g. "INBOX" or "Applications". */
  mailbox: string;
}

export interface SourceSettings {
  kind: 'local' | 'cloud' | 'email';
  /** Local: absolute folder path. Cloud: reserved for connector config. Email: unused. */
  path: string;
  provider?: 'gdrive' | 'onedrive' | 's3';
  /** IMAP connection when kind === 'email'. */
  imap?: ImapSettings;
}

/** OCR for scanned (image-only) PDFs. Slow, so it only runs on PDFs with no text layer. */
export interface OcrSettings {
  enabled: boolean;
  /** Tesseract language code(s), e.g. "eng", or "eng+deu" for multiple. */
  language: string;
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
  ocr: OcrSettings;
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

/**
 * Alternative spellings for a keyword that should also count as a match, e.g.
 * canonical "AWS" with aliases ["Amazon Web Services", "AWS Cloud"]. Applies to
 * mandatory and optional keywords alike; the canonical term is what gets recorded.
 */
export interface KeywordSynonym {
  canonical: string;
  aliases: string[];
}

/**
 * Structured requirement tags the recruiter sets per job. Empty list / nulls /
 * empty string mean "not required for this role". Unlike keywords these are
 * judged by the LLM (experience and publication relevance aren't reliably
 * decidable by string matching).
 */
export interface JobCriteria {
  /** Exact certification names, all required (e.g. "AWS Certified Solutions Architect"). */
  certifications: string[];
  /** Required years of relevant experience; either bound may be null (open-ended). */
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  /** Field the applicant must have research publications in (e.g. "machine learning"). */
  publicationsField: string;
}

/** Per-requirement LLM verdicts; null field = that category wasn't required. */
export interface CriteriaVerdict {
  certificationsMet: boolean | null;
  experienceYears: number | null;
  experienceInRange: boolean | null;
  publicationsMatch: boolean | null;
}

/**
 * Formal-education breakdown the LLM extracts for every analyzed CV. Unlike the
 * requirement tags this is always assessed — the recruiter asked for education
 * to weigh into every score. Any field the CV doesn't reveal comes back null.
 */
export interface EducationVerdict {
  /** School-leaving marks, as a percentage 0-100. */
  tenthPercentage: number | null;
  twelfthPercentage: number | null;
  /** University CGPA and the scale it is out of (e.g. 8.7 on a scale of 10). */
  cgpa: number | null;
  cgpaScale: number | null;
  /** Highest qualification, e.g. "B.Tech", "M.Sc", "PhD". */
  highestDegree: string | null;
  /** The model's 0-100 rating of the candidate's formal education strength. */
  educationScore: number | null;
}

export const EMPTY_CRITERIA: JobCriteria = {
  certifications: [],
  experienceMinYears: null,
  experienceMaxYears: null,
  publicationsField: '',
};

export function criteriaActive(c: JobCriteria | null | undefined): boolean {
  return !!c && (
    c.certifications.length > 0 ||
    c.experienceMinYears !== null ||
    c.experienceMaxYears !== null ||
    c.publicationsField.trim().length > 0
  );
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
  /** LLM affinity score, 0-100 (jobs scored before the 100-point rework hold 0-10 values). */
  score: number | null;
  reasoning: string | null;
  /**
   * Weighted mandatory-keyword score out of 5: each matched keyword earns its
   * importance as marks (missing = 0); this is the average across all mandatory
   * keywords. Null on jobs screened before the feature existed.
   */
  keywordScore: number | null;
  /** LLM verdicts on the job's requirement tags; null until analyzed or when none were set. */
  criteria: CriteriaVerdict | null;
  /** Formal-education breakdown from the LLM; null until analyzed. */
  education: EducationVerdict | null;
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
  /** Recruiter-defined alternative spellings that broaden keyword matching. */
  keywordSynonyms: KeywordSynonym[];
  criteria: JobCriteria;
  /** How many candidates the recruiter intends to hire; null = no target. */
  targetAcceptances: number | null;
  sourcePath: string;
  /**
   * Email source (kind === 'email'): the mailbox to pull from and the date range
   * of applications to import. Dates are ISO yyyy-mm-dd; the range is inclusive.
   */
  emailImap?: ImapSettings;
  emailDateFrom?: string;
  emailDateTo?: string;
  /** OCR config for scanned PDFs; omit to disable. */
  ocr?: OcrSettings;
  concurrency: number;
}

export interface ScreeningResult {
  jobId: number;
  rejected: ApplicationRow[];
  acceptedMandatory: ApplicationRow[];
  acceptedOptional: ApplicationRow[];
  failures: ParseFailure[];
  /** Recruiter's hiring target for this job, echoed back for the shortfall banner; null = none. */
  targetAcceptances: number | null;
}

export interface ScreeningProgress {
  phase: 'importing' | 'scanning' | 'parsing' | 'analyzing';
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
