import { useState } from 'react';
import type { ApplicationRow, SettingsProfile } from '@avanzare/engine';
import { avz, call, type EmailBatchReport, type EmailTemplates } from '../api';
import ContactCell from '../components/ContactCell';
import HistoryCell from '../components/HistoryCell';
import CvDrawer, { type CvDrawerTarget } from '../components/CvDrawer';
import NoteDialog from '../components/NoteDialog';
import EmailPreviewModal from '../components/EmailPreviewModal';

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
 * unchecked get the rejection email — everyone in this table is emailed, so the
 * send goes through the preview modal and a 30-second undo countdown.
 */
export default function Results({ rows: initialRows, failures, jobId, jobTitle, profile, notify, onDone }: Props) {
  const [rows, setRows] = useState<ApplicationRow[]>(initialRows);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [reports, setReports] = useState<EmailBatchReport[] | null>(null);
  const [drawer, setDrawer] = useState<CvDrawerTarget | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

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

  const patchRow = (id: number, patch: Partial<ApplicationRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const acceptedRows = rows.filter(r => checked.has(r.id));
  const rejectedRows = rows.filter(r => !checked.has(r.id));

  const doSend = async (templatesOverride: EmailTemplates) => {
    setPreviewOpen(false);
    setSending(true);
    const res = await call(avz.sendEmails({
      jobId, profile,
      batches: [
        { kind: 'acceptance', applicationIds: acceptedRows.map(r => r.id) },
        { kind: 'rejection', applicationIds: rejectedRows.map(r => r.id) },
      ],
      templatesOverride,
    }), notify);
    setSending(false);
    if (!res) return;
    setReports(res);
    const total = res.reduce((n, b) => n + b.report.sent, 0);
    const failedN = res.reduce((n, b) => n + b.report.failed.length, 0);
    notify(`Emails: ${total} sent, ${failedN} failed.`, failedN ? 'error' : 'info');
  };

  const addNote = async (note: string) => {
    setNoteOpen(false);
    const ids = [...new Set(acceptedRows.map(r => r.candidateId))];
    const res = await avz.candidates.addNote({ candidateIds: ids, note });
    if (!res.ok) { notify(res.error.message); return; }
    notify(`Note added to ${ids.length} candidate(s).`, 'info');
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
        Click a name to preview the CV in-app.
      </p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked} onChange={toggleAll} title="Select all" /></th>
              <th>Name &amp; contact</th>
              <th>History &amp; notes</th>
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
                  <td>
                    <button className="linklike" style={{ fontWeight: 600 }}
                      onClick={() => setDrawer({ applicationId: r.id, name: r.name, cvPath: r.cvPath })}>
                      {r.name}
                    </button>
                    <ContactCell candidateId={r.candidateId} name={r.name} email={r.email} phone={r.phone}
                      onSaved={v => patchRow(r.id, v)} notify={notify} />
                  </td>
                  <td>
                    <HistoryCell candidateId={r.candidateId} priorCount={r.priorCount}
                      currentJobId={r.jobId} notify={notify} />
                    {r.notes && <div className="notes-preview">{r.notes}</div>}
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
          <button className="btn primary" disabled={sending || rows.length === 0} onClick={() => setPreviewOpen(true)}>
            Send emails ({acceptedRows.length} acceptance{acceptedRows.length === 1 ? '' : 's'}, {rejectedRows.length} rejection{rejectedRows.length === 1 ? '' : 's'})…
          </button>
        ) : (
          <button className="btn primary" onClick={onDone}>Finish — new screening</button>
        )}
        <button className="btn" disabled={checked.size === 0} onClick={() => setNoteOpen(true)}>
          Add note to selected ({checked.size})
        </button>
        <button className="btn" onClick={exportTable}>Export to Excel</button>
        {!reports && <button className="btn" onClick={onDone}>Finish without sending</button>}
      </div>

      <CvDrawer target={drawer} onClose={() => setDrawer(null)} notify={notify} />
      {noteOpen && <NoteDialog count={new Set(acceptedRows.map(r => r.candidateId)).size}
        onSave={n => void addNote(n)} onCancel={() => setNoteOpen(false)} />}
      {previewOpen && (
        <EmailPreviewModal
          jobTitle={jobTitle}
          templates={profile.templates}
          batches={[
            { kind: 'acceptance', apps: acceptedRows },
            { kind: 'rejection', apps: rejectedRows },
          ]}
          onConfirm={tpl => void doSend(tpl)}
          onCancel={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
