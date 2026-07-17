import type {
  ApplicationRow, ConnectionTestResult, EmailSendReport, LlmSettings,
  ScreeningInput, ScreeningProgress, ScreeningResult, SettingsProfile, Tier,
} from '@avanzare/engine';

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
  sendEmails(payload: { jobId: number; profile: SettingsProfile; batches: { kind: 'rejection' | 'acceptance'; applicationIds: number[] }[] }):
    Promise<Envelope<EmailBatchReport[]>>;
  exportTable(payload: {
    kind: 'applications' | 'results' | 'candidates';
    applicationIds?: number[];
    decisions?: [number, string][];
    suggestedName: string;
  }): Promise<Envelope<{ saved: boolean; path?: string }>>;
  candidates: {
    list(): Promise<Envelope<CandidateRecord[]>>;
    purge(id: number): Promise<Envelope<void>>;
  };
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
