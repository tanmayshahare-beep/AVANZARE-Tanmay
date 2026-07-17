import { useMemo, useState } from 'react';
import type { ApplicationRow, ScreeningResult, SettingsProfile } from '@avanzare/engine';
import { avz, call, type EmailBatchReport } from '../api';

interface Props {
  screening: ScreeningResult;
  jobTitle: string;
  profile: SettingsProfile;
  notify: (msg: string, kind?: 'error' | 'info') => void;
  onContinue: (rescuedIds: number[]) => void;
}

/**
 * Rejection review. Everyone here failed the mandatory keywords, so all rows
 * start CHECKED (checked = confirm rejection + email). Unchecking a row rescues
 * it into the LLM analysis pool.
 */
export default function Rejection({ screening, jobTitle, profile, notify, onContinue }: Props) {
  const rows = screening.rejected;
  const [checked, setChecked] = useState<Set<number>>(() => new Set(rows.map(r => r.id)));
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<EmailBatchReport | null>(null);

  const allChecked = checked.size === rows.length && rows.length > 0;
  const rescued = useMemo(() => rows.filter(r => !checked.has(r.id)), [rows, checked]);
  const acceptedCount = screening.acceptedMandatory.length + screening.acceptedOptional.length;

  const toggle = (id: number) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(rows.map(r => r.id)));

  const selectedWithEmail = rows.filter(r => checked.has(r.id) && r.email).length;
  const selectedNoEmail = rows.filter(r => checked.has(r.id) && !r.email).length;

  const sendAndContinue = async () => {
    const ids = rows.filter(r => checked.has(r.id)).map(r => r.id);
    if (ids.length) {
      const summary = `Send rejection emails to ${selectedWithEmail} applicant(s)?` +
        (selectedNoEmail ? `\n(${selectedNoEmail} selected applicant(s) have no email on file and will only be marked as rejected.)` : '');
      if (!window.confirm(summary)) return;
      setSending(true);
      const res = await call(avz.sendEmails({
        jobId: screening.jobId, profile,
        batches: [{ kind: 'rejection', applicationIds: ids }],
      }), notify);
      setSending(false);
      if (!res) return;
      setReport(res[0]);
      const r = res[0].report;
      notify(`Rejection emails: ${r.sent} sent, ${r.failed.length} failed, ${r.noEmail.length} without email.`,
        r.failed.length ? 'error' : 'info');
    }
    onContinue(rescued.map(r => r.id));
  };

  const exportTable = async () => {
    const decisions: [number, string][] = rows.map(r => [r.id, checked.has(r.id) ? 'reject' : 'rescued']);
    const res = await call(avz.exportTable({
      kind: 'applications',
      applicationIds: rows.map(r => r.id),
      decisions,
      suggestedName: `rejection-review-${jobTitle.replace(/\W+/g, '-')}.xlsx`,
      exportDir: profile.exportDir,
    }), notify);
    if (res?.saved) notify(`Exported to ${res.path}`, 'info');
  };

  return (
    <div className="panel">
      <h2>Rejection review</h2>
      <p className="hint">
        {rows.length} CV(s) are missing at least one mandatory keyword. {acceptedCount} CV(s) passed and will be analyzed.
        Checked applicants get a rejection email — <strong>uncheck</strong> anyone you want to rescue into the LLM analysis instead.
        {screening.failures.length > 0 && (
          <> <span className="danger-text">{screening.failures.length} file(s) could not be parsed</span> — see below.</>
        )}
      </p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked} onChange={toggleAll} title="Select all" /></th>
              <th>Name</th>
              <th>Contact info</th>
              <th>Missing / matched keywords</th>
              <th>CV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => <Row key={r.id} r={r} checked={checked.has(r.id)} onToggle={() => toggle(r.id)} notify={notify} />)}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No CVs were rejected by the keyword filter.</td></tr>}
          </tbody>
        </table>
      </div>

      {screening.failures.length > 0 && (
        <>
          <h3>Unparseable files</h3>
          {screening.failures.map(f => (
            <div className="test-result" key={f.file}>
              <span className="danger-text">✗</span>
              <span className="code">{f.code}</span>
              <span>{f.file}</span>
            </div>
          ))}
        </>
      )}

      <div className="btn-row">
        <button className="btn primary" disabled={sending || !!report} onClick={sendAndContinue}>
          {checked.size > 0
            ? `Send rejection emails to selected (${checked.size}) & continue`
            : 'Continue to LLM analysis'}
        </button>
        {checked.size > 0 && !report && (
          <button className="btn" disabled={sending} onClick={() => onContinue(rescued.map(r => r.id))}>
            Continue without sending
          </button>
        )}
        {report && (
          <button className="btn primary" onClick={() => onContinue(rescued.map(r => r.id))}>
            Continue to LLM analysis →
          </button>
        )}
        <button className="btn" onClick={exportTable}>Export to Excel</button>
        <span className="muted">{rescued.length} unchecked → will join the LLM analysis</span>
      </div>
    </div>
  );
}

function Row({ r, checked, onToggle, notify }: {
  r: ApplicationRow; checked: boolean; onToggle: () => void;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}) {
  return (
    <tr>
      <td><input type="checkbox" checked={checked} onChange={onToggle} /></td>
      <td>{r.name}</td>
      <td>
        {r.email ?? <span className="badge warn">no email found</span>}
        {r.phone && <div className="sub">{r.phone}</div>}
      </td>
      <td>
        {r.matchedMandatory.length > 0 && <span className="sub">has: {r.matchedMandatory.join(', ')}</span>}
        {r.matchedMandatory.length > 0 && <br />}
        <span className="sub danger-text">missing mandatory keyword(s)</span>
      </td>
      <td>
        <button className="linklike" onClick={() => void call(avz.openFile(r.cvPath), notify)}>
          Open {r.cvPath.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Word'}
        </button>
      </td>
    </tr>
  );
}
