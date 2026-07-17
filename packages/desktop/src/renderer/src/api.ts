import type {
  ApplicationRow, AuditEntry, CandidateHistoryEntry, CandidateSearchHit, ConnectionTestResult, EmailSendReport,
  EmailTemplates, JobMetrics, LlmSettings,
  ScreeningInput, ScreeningProgress, ScreeningResult, SettingsProfile, Tier,
} from '@avanzare/engine';

export type { CandidateHistoryEntry, AuditEntry, JobMetrics, EmailTemplates, CandidateSearchHit };

export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; location: string } };

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

export interface EmailBatchReport { kind: 'rejection' | 'acceptance'; report: EmailSendReport }

interface AvzApi {
  profiles: {
    list(): Promise<Envelope<SettingsProfile[]>>;
    save(p: SettingsProfile): Promise<Envelope<void>>;
    delete(name: string): Promise<Envelope<void>>;
  };
  testConnections(p: SettingsProfile): Promise<Envelope<ConnectionTestResult[]>>;
  listModels(llm: LlmSettings): Promise<Envelope<string[]>>;
  runScreening(input: ScreeningInput): Promise<Envelope<ScreeningResult>>;
  setTier(ids: number[], tier: Tier): Promise<Envelope<void>>;
  analyze(payload: { jobId: number; applicationIds: number[]; profile: SettingsProfile }):
    Promise<Envelope<{ rows: ApplicationRow[]; failures: { applicationId: number; code: string; message: string }[] }>>;
  sendEmails(payload: {
    jobId: number; profile: SettingsProfile;
    batches: { kind: 'rejection' | 'acceptance'; applicationIds: number[] }[];
    templatesOverride?: EmailTemplates;
  }): Promise<Envelope<EmailBatchReport[]>>;
  exportTable(payload: {
    kind: 'applications' | 'results' | 'candidates' | 'audit';
    applicationIds?: number[];
    decisions?: [number, string][];
    suggestedName: string;
    exportDir?: string;
  }): Promise<Envelope<{ saved: boolean; path?: string }>>;
  lastJob(): Promise<Envelope<{
    job: { id: number; title: string; createdAt: string };
    applications: ApplicationRow[];
  } | null>>;
  candidates: {
    list(): Promise<Envelope<CandidateRecord[]>>;
    search(query: string): Promise<Envelope<CandidateSearchHit[]>>;
    purge(id: number): Promise<Envelope<void>>;
    addNote(payload: { candidateIds: number[]; note: string }): Promise<Envelope<void>>;
    history(id: number): Promise<Envelope<CandidateHistoryEntry[]>>;
  };
  updateContact(payload: { candidateId: number; name: string; email: string | null; phone: string | null }): Promise<Envelope<void>>;
  cvText(applicationId: number): Promise<Envelope<string>>;
  jobs(): Promise<Envelope<{ id: number; title: string; createdAt: string }[]>>;
  jobMetrics(jobId: number): Promise<Envelope<JobMetrics>>;
  jobApplications(jobId: number): Promise<Envelope<ApplicationRow[]>>;
  auditList(limit?: number): Promise<Envelope<AuditEntry[]>>;
  openFile(path: string): Promise<Envelope<void>>;
  pickFolder(): Promise<Envelope<string | null>>;
  onProgress(cb: (p: ScreeningProgress) => void): () => void;
}

export const avz = (window as unknown as { avz: AvzApi }).avz;

/** Unwrap an envelope; on failure surface the AVZ code via the provided reporter. */
export async function call<T>(p: Promise<Envelope<T>>, onError: (msg: string) => void): Promise<T | null> {
  const res = await p;
  if (res.ok) return res.data;
  onError(res.error.message);
  return null;
}
