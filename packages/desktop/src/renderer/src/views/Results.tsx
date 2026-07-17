import { useState } from 'react';
import type { ApplicationRow, SettingsProfile } from '@avanzare/engine';
import { avz, call, type EmailBatchReport } from '../api';

interface Props {
  rows: ApplicationRow[];
  failures: { applicationId: number; code: string; message: string }[];
  jobId: number;
  jobTitle: string;
  profile: SettingsProfile;
  notify: (msg: string, kind?: 'error' | 'info') => void;
  onDone: () => void;
}

const TIER_LABEL: Record<string, { text: string; cls: string }> = {
  optional: { text: 'mandatory + optional', cls: 'ok' },
  mandatory: { text: 'mandatory only', cls: '' },
  rescued: { text: 'rescued', cls: 'warn' },
};

/**
 * LLM results, sorted by score. All rows start UNCHECKED: advancing a candidate
 * is a positive decision. On confirm, checked get the acceptance email and
 * unchecked get the rejection email — everyone in this table is emailed.
 */
export default function Results({ rows, failures, jobId, jobTitle, profile, notify, onDone }: Props) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [reports, setReports] = useState<EmailBatchReport[] | null>(null);

  const allChecked = checked.size === rows.length && rows.length > 0;
  const toggle = (id: number) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(rows.map(r => r.id)));
  const toggleExpand = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const acceptedIds = rows.filter(r => checked.has(r.id)).map(r => r.id);
  const rejectedIds = rows.filter(r => !checked.has(r.id)).map(r => r.id);

  const send = async () => {
    const msg =
      `You are about to email EVERY candidate in this table:\n\n` +
      `  • ${acceptedIds.length} acceptance email(s) (checked)\n` +
      `  • ${rejectedIds.length} rejection email(s) (unchecked)\n\n` +
      `Candidates without an email address are only marked in the database. Proceed?`;
    if (!window.confirm(msg)) return;
    setSending(true);
    const res = await call(avz.sendEmails({
      jobId, profile,
      batches: [
        { kind: 'acceptance', applicationIds: acceptedIds },
        { kind: 'rejection', applicationIds: rejectedIds },
      ],
    }), notify);
    setSending(false);
    if (!res) return;
    setReports(res);
    const total = res.reduce((n, b) => n + b.report.sent, 0);
    const failedN = res.reduce((n, b) => n + b.report.failed.length, 0);
    notify(`Emails: ${total} sent, ${failedN} failed.`, failedN ? 'error' : 'info');
  };

  const exportTable = async () => {
    const decisions: [number, string][] = rows.map(r => [r.id, checked.has(r.id) ? 'accept' : 'reject']);
    const res = await call(avz.exportTable({
      kind: 'results',
      applicationIds: rows.map(r => r.id),
      decisions,
      suggestedName: `llm-results-${jobTitle.replace(/\W+/g, '-')}.xlsx`,
      exportDir: profile.exportDir,
    }), notify);
    if (res?.saved) notify(`Exported to ${res.path}`, 'info');
  };

  return (
    <div className="panel">
      <h2>LLM analysis — {jobTitle}</h2>
      <p className="hint">
        Sorted by affinity score. <strong>Check</strong> the candidates you want to advance; on send,
        checked receive the acceptance email and unchecked receive the rejection email.
      </p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked} onChange={toggleAll} title="Select all" /></th>
              <th>Name</th>
              <th>Contact info</th>
              <th>Tier</th>
              <th>Score /10</th>
              <th>Reasoning</th>
              <th>CV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const tier = TIER_LABEL[r.tier] ?? { text: r.tier, cls: '' };
              const isOpen = expanded.has(r.id);
              const reasoning = r.reasoning ?? '(no verdict — analysis failed for this CV)';
              return (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td>{r.name}</td>
                  <td>
                    {r.email ?? <span className="badge warn">no email found</span>}
                    {r.phone && <div className="sub">{r.phone}</div>}
                  </td>
                  <td><span className={`badge ${tier.cls}`}>{tier.text}</span></td>
                  <td><span className="score">{r.score !== null ? r.score.toFixed(1) : '—'}</span></td>
                  <td className="reasoning">
                    <span className="preview" onClick={() => toggleExpand(r.id)} title="Click to expand/collapse">
                      {isOpen || reasoning.length <= 90 ? reasoning : reasoning.slice(0, 90) + '… ▸'}
                    </span>
                  </td>
                  <td>
                    <button className="linklike" onClick={() => void call(avz.openFile(r.cvPath), notify)}>
                      Open {r.cvPath.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Word'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No candidates reached the analysis stage.</td></tr>}
          </tbody>
        </table>
      </div>

      {failures.length > 0 && (
        <>
          <h3>Analysis failures</h3>
          {failures.map(f => (
            <div className="test-result" key={f.applicationId}>
              <span className="danger-text">✗</span><span className="code">{f.code}</span><span>{f.message}</span>
            </div>
          ))}
        </>
      )}

      {reports && (
        <>
          <h3>Send report</h3>
          {reports.map(b => (
            <div className="test-result" key={b.kind}>
              <span className={b.report.failed.length ? 'danger-text' : 'ok-text'}>
                {b.report.failed.length ? '△' : '✓'}
              </span>
              <strong>{b.kind}</strong>
              <span>{b.report.sent} sent, {b.report.failed.length} failed, {b.report.noEmail.length} without email</span>
            </div>
          ))}
          {reports.flatMap(b => b.report.failed).map(f => (
            <div className="test-result" key={f.applicationId}>
              <span className="danger-text">✗</span><span className="code">{f.code}</span><span>{f.name}: {f.message}</span>
            </div>
          ))}
        </>
      )}

      <div className="btn-row">
        {!reports ? (
          <button className="btn primary" disabled={sending || rows.length === 0} onClick={send}>
            Send emails ({acceptedIds.length} acceptance{acceptedIds.length === 1 ? '' : 's'}, {rejectedIds.length} rejection{rejectedIds.length === 1 ? '' : 's'})
          </button>
        ) : (
          <button className="btn primary" onClick={onDone}>Finish — new screening</button>
        )}
        <button className="btn" onClick={exportTable}>Export to Excel</button>
        {!reports && <button className="btn" onClick={onDone}>Finish without sending</button>}
      </div>
    </div>
  );
}
