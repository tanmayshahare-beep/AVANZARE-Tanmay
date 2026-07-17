import { useMemo, useState } from 'react';
import type { ApplicationRow, ScreeningResult, SettingsProfile } from '@avanzare/engine';
import { avz, call, type EmailBatchReport, type EmailTemplates } from '../api';
import ContactCell from '../components/ContactCell';
import HistoryCell from '../components/HistoryCell';
import CvDrawer, { type CvDrawerTarget } from '../components/CvDrawer';
import NoteDialog from '../components/NoteDialog';
import EmailPreviewModal from '../components/EmailPreviewModal';

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
  const [rows, setRows] = useState<ApplicationRow[]>(screening.rejected);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(screening.rejected.map(r => r.id)));
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<EmailBatchReport | null>(null);
  const [drawer, setDrawer] = useState<CvDrawerTarget | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const allChecked = checked.size === rows.length && rows.length > 0;
  const rescued = useMemo(() => rows.filter(r => !checked.has(r.id)), [rows, checked]);
  const acceptedCount = screening.acceptedMandatory.length + screening.acceptedOptional.length;
  const selected = rows.filter(r => checked.has(r.id));

  const toggle = (id: number) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(rows.map(r => r.id)));

  const patchRow = (id: number, patch: Partial<ApplicationRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const doSend = async (templatesOverride: EmailTemplates) => {
    setPreviewOpen(false);
    setSending(true);
    const res = await call(avz.sendEmails({
      jobId: screening.jobId, profile,
      batches: [{ kind: 'rejection', applicationIds: selected.map(r => r.id) }],
      templatesOverride,
    }), notify);
    setSending(false);
    if (!res) return;
    setReport(res[0]);
    const r = res[0].report;
    notify(`Rejection emails: ${r.sent} sent, ${r.failed.length} failed, ${r.noEmail.length} without email.`,
      r.failed.length ? 'error' : 'info');
  };

  const addNote = async (note: string) => {
    setNoteOpen(false);
    const ids = [...new Set(selected.map(r => r.candidateId))];
    const res = await avz.candidates.addNote({ candidateIds: ids, note });
    if (!res.ok) { notify(res.error.message); return; }
    notify(`Note added to ${ids.length} candidate(s).`, 'info');
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
        Click a name to preview the CV in-app; use ✎ to fix badly extracted contact info.
        {screening.failures.length > 0 && (
          <> <span className="danger-text">{screening.failures.length} file(s) could not be parsed</span> — see below.</>
        )}
      </p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked} onChange={toggleAll} title="Select all" /></th>
              <th>Name &amp; contact</th>
              <th>History &amp; notes</th>
              <th>Missing / matched keywords</th>
              <th>CV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
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
            ))}
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
        <button className="btn primary" disabled={sending || !!report || checked.size === 0}
          onClick={() => setPreviewOpen(true)}>
          Send rejection emails to selected ({checked.size})…
        </button>
        {!report ? (
          <button className="btn" disabled={sending} onClick={() => onContinue(rescued.map(r => r.id))}>
            {checked.size > 0 ? 'Continue without sending' : 'Continue to LLM analysis'}
          </button>
        ) : (
          <button className="btn primary" onClick={() => onContinue(rescued.map(r => r.id))}>
            Continue to LLM analysis →
          </button>
        )}
        <button className="btn" disabled={checked.size === 0} onClick={() => setNoteOpen(true)}>
          Add note to selected ({checked.size})
        </button>
        <button className="btn" onClick={exportTable}>Export to Excel</button>
        <span className="muted">{rescued.length} unchecked → will join the LLM analysis</span>
      </div>

      <CvDrawer target={drawer} onClose={() => setDrawer(null)} notify={notify} />
      {noteOpen && <NoteDialog count={new Set(selected.map(r => r.candidateId)).size}
        onSave={n => void addNote(n)} onCancel={() => setNoteOpen(false)} />}
      {previewOpen && (
        <EmailPreviewModal
          jobTitle={jobTitle}
          templates={profile.templates}
          batches={[{ kind: 'rejection', apps: selected }]}
          onConfirm={tpl => void doSend(tpl)}
          onCancel={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
