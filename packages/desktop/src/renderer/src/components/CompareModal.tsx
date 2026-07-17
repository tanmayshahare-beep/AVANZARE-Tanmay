import type { ReactNode } from 'react';
import type { ApplicationRow } from '@avanzare/engine';
import { avz, call } from '../api';
import CriteriaBadges from './CriteriaBadges';
import EducationCell from './EducationCell';

interface Props {
  rows: ApplicationRow[];
  jobTitle: string;
  notify: (msg: string, kind?: 'error' | 'info') => void;
  onClose: () => void;
}

const TIER_LABEL: Record<string, { text: string; cls: string }> = {
  optional: { text: 'mandatory + optional', cls: 'ok' },
  mandatory: { text: 'mandatory only', cls: '' },
  rescued: { text: 'rescued', cls: 'warn' },
  rejected: { text: 'rejected', cls: 'danger' },
};

/**
 * Side-by-side comparison of the selected candidates: one column per candidate,
 * one row per attribute (score, education, requirement verdicts, matched
 * keywords, reasoning). Read-only — a decision aid for the final short-list.
 */
export default function CompareModal({ rows, jobTitle, notify, onClose }: Props) {
  const chips = (items: string[], cls = '') =>
    items.length
      ? <span className="btn-row" style={{ margin: 0, gap: 4 }}>{items.map(k => <span className={`badge ${cls}`} key={k}>{k}</span>)}</span>
      : <span className="muted">—</span>;

  // Each attribute is a row; render() produces one cell per candidate.
  const attributes: { label: string; render: (r: ApplicationRow) => ReactNode }[] = [
    { label: 'Tier', render: r => { const t = TIER_LABEL[r.tier] ?? { text: r.tier, cls: '' }; return <span className={`badge ${t.cls}`}>{t.text}</span>; } },
    { label: 'Score /100', render: r => <span className="score">{r.score !== null ? Math.round(r.score) : '—'}</span> },
    { label: 'Keyword score /5', render: r => r.keywordScore !== null ? r.keywordScore.toFixed(1) : '—' },
    { label: 'Education', render: r => <EducationCell verdict={r.education} /> },
    { label: 'Requirements', render: r => <CriteriaBadges verdict={r.criteria} /> },
    { label: 'Matched mandatory', render: r => chips(r.matchedMandatory) },
    { label: 'Matched optional', render: r => chips(r.matchedOptional, 'ok') },
    { label: 'Contact', render: r => <span className="sub">{r.email ?? '(no email)'}{r.phone ? ` · ${r.phone}` : ''}</span> },
    { label: 'Reasoning', render: r => <span className="sub" style={{ whiteSpace: 'normal' }}>{r.reasoning ?? '—'}</span> },
    { label: 'CV', render: r => <button className="linklike" onClick={() => void call(avz.openFile(r.cvPath), notify)}>Open</button> },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 'min(1200px, 96vw)' }} onClick={e => e.stopPropagation()}>
        <h2>Compare candidates — {jobTitle}</h2>
        <p className="hint">{rows.length} candidate(s) side by side. Sorted by score, highest first.</p>
        <div className="tablewrap">
          <table className="compare">
            <thead>
              <tr>
                <th style={{ minWidth: 130 }}>&nbsp;</th>
                {rows.map(r => <th key={r.id} style={{ minWidth: 200 }}>{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {attributes.map(attr => (
                <tr key={attr.label}>
                  <th scope="row" style={{ verticalAlign: 'top', color: 'var(--muted)' }}>{attr.label}</th>
                  {rows.map(r => <td key={r.id}>{attr.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
