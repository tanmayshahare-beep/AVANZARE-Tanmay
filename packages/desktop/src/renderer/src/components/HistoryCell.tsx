import { useState } from 'react';
import { avz, call, type CandidateHistoryEntry } from '../api';

interface Props {
  candidateId: number;
  priorCount: number;
  /** Job to exclude from the list (the one currently on screen), if any. */
  currentJobId?: number;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

const OUTCOME: Record<string, string> = {
  pending: 'pending',
  rejected_notified: 'rejected',
  rejected_final: 'rejected',
  in_llm: 'analyzed',
  accepted: 'accepted',
};

/**
 * Cross-job history: "applied before" badge that expands into the candidate's
 * past applications with scores and outcomes — so nobody shortlists a person
 * rejected last month for the same role, or overlooks a known high-performer.
 */
export default function HistoryCell({ candidateId, priorCount, currentJobId, notify }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CandidateHistoryEntry[] | null>(null);

  if (priorCount <= 0) return null;

  const toggle = async () => {
    if (!open && rows === null) {
      const res = await call(avz.candidates.history(candidateId), notify);
      if (res) setRows(res.filter(r => r.jobId !== currentJobId));
    }
    setOpen(!open);
  };

  return (
    <div>
      <button className="linklike" style={{ fontSize: 12 }} onClick={() => void toggle()}>
        ↺ applied to {priorCount} other job{priorCount === 1 ? '' : 's'} {open ? '▾' : '▸'}
      </button>
      {open && rows && (
        <div className="history-box">
          {rows.map(h => (
            <div className="hrow" key={h.applicationId}>
              <span className="sub">{h.jobDate.slice(0, 10)}</span>
              <strong>{h.jobTitle}</strong>
              <span className={`badge ${h.status === 'accepted' ? 'ok' : h.status.startsWith('rejected') ? 'danger' : ''}`}>
                {OUTCOME[h.status] ?? h.status}
              </span>
              {h.score !== null && (
                <span className="score" style={{ fontSize: 12 }} title="LLM affinity score">
                  {Math.round(h.score)}
                </span>
              )}
            </div>
          ))}
          {rows.length === 0 && <span className="muted">No other applications on record.</span>}
        </div>
      )}
    </div>
  );
}
