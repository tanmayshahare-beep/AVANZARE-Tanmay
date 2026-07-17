import { useEffect, useState } from 'react';
import { avz, call, type CandidateRecord } from '../api';
import ContactCell from '../components/ContactCell';
import HistoryCell from '../components/HistoryCell';
import NoteDialog from '../components/NoteDialog';

interface Props {
  exportDir?: string;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

/** The persistent talent database accumulated across screening runs. */
export default function Candidates({ exportDir, notify }: Props) {
  const [rows, setRows] = useState<CandidateRecord[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [noteOpen, setNoteOpen] = useState(false);

  const refresh = async () => {
    const list = await call(avz.candidates.list(), notify);
    if (list) { setRows(list); setChecked(new Set()); }
  };
  useEffect(() => { void refresh(); }, []);

  const allChecked = checked.size === rows.length && rows.length > 0;
  const toggle = (id: number) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const purge = async (c: CandidateRecord) => {
    if (!window.confirm(
      `Permanently delete ${c.name} (${c.email ?? 'no email'}) and all their application records?\n` +
      'Use this for data-deletion (GDPR) requests. This cannot be undone.')) return;
    await call(avz.candidates.purge(c.id), notify);
    void refresh();
  };

  const addNote = async (note: string) => {
    setNoteOpen(false);
    const res = await avz.candidates.addNote({ candidateIds: [...checked], note });
    if (!res.ok) { notify(res.error.message); return; }
    notify(`Note added to ${checked.size} candidate(s).`, 'info');
    void refresh();
  };

  const exportTable = async () => {
    const res = await call(avz.exportTable({ kind: 'candidates', suggestedName: 'candidates.xlsx', exportDir }), notify);
    if (res?.saved) notify(`Exported to ${res.path}`, 'info');
  };

  return (
    <div className="panel">
      <h2>Candidate database</h2>
      <p className="hint">
        Contact info, notes and application history of every applicant ever parsed, deduplicated by email.
        This is personal data — use “Delete” to honor erasure requests.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked}
                onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map(r => r.id)))} title="Select all" /></th>
              <th>Name &amp; contact</th><th>History</th><th>Notes</th><th>First seen</th><th>Last seen</th><th>CV</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td><input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                <td>
                  <ContactCell candidateId={c.id} name={c.name} email={c.email} phone={c.phone}
                    onSaved={v => setRows(prev => prev.map(x => x.id === c.id ? { ...x, ...v } : x))} notify={notify} />
                </td>
                <td>
                  {c.applicationCount > 0
                    ? <HistoryCell candidateId={c.id} priorCount={c.applicationCount} notify={notify} />
                    : <span className="muted">—</span>}
                </td>
                <td>{c.notes ? <div className="notes-preview">{c.notes}</div> : <span className="muted">—</span>}</td>
                <td className="sub">{c.firstSeen.slice(0, 10)}</td>
                <td className="sub">{c.lastSeen.slice(0, 10)}</td>
                <td>
                  {c.lastCvPath && (
                    <button className="linklike" onClick={() => void call(avz.openFile(c.lastCvPath!), notify)}>Open</button>
                  )}
                </td>
                <td><button className="btn small danger" onClick={() => void purge(c)}>Delete</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">No candidates parsed yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="btn" disabled={checked.size === 0} onClick={() => setNoteOpen(true)}>
          Add note to selected ({checked.size})
        </button>
        <button className="btn" onClick={exportTable}>Export to Excel</button>
      </div>
      {noteOpen && <NoteDialog count={checked.size} onSave={n => void addNote(n)} onCancel={() => setNoteOpen(false)} />}
    </div>
  );
}
