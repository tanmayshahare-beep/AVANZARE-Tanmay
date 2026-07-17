import { useEffect, useState } from 'react';
import { avz, call, type CandidateRecord, type CandidateSearchHit } from '../api';
import ContactCell from '../components/ContactCell';
import HistoryCell from '../components/HistoryCell';
import NoteDialog from '../components/NoteDialog';

/** Render an FTS snippet, highlighting the ⟪…⟫-marked hit terms. */
function Snippet({ text }: { text: string }) {
  if (!text) return <span className="muted">—</span>;
  const parts = text.split(/(⟪[^⟫]*⟫)/g);
  return (
    <span className="sub">
      {parts.map((p, i) => p.startsWith('⟪') && p.endsWith('⟫')
        ? <mark key={i}>{p.slice(1, -1)}</mark>
        : <span key={i}>{p}</span>)}
    </span>
  );
}

interface Props {
  exportDir?: string;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

/** The persistent talent database accumulated across screening runs. */
export default function Candidates({ exportDir, notify }: Props) {
  const [rows, setRows] = useState<CandidateRecord[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [noteOpen, setNoteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CandidateSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const refresh = async () => {
    const list = await call(avz.candidates.list(), notify);
    if (list) { setRows(list); setChecked(new Set()); }
  };
  useEffect(() => { void refresh(); }, []);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    setSearching(true);
    const hits = await call(avz.candidates.search(q), notify);
    setSearching(false);
    if (hits) setResults(hits);
  };
  const clearSearch = () => { setQuery(''); setResults(null); };

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

      <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
        <input type="text" style={{ maxWidth: 360 }} value={query} placeholder="Search all CVs & names (e.g. Kubernetes Terraform)"
          onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }} />
        <button className="btn" disabled={searching || !query.trim()} onClick={() => void runSearch()}>Search</button>
        {results !== null && <button className="btn" onClick={clearSearch}>Clear</button>}
      </div>

      {results !== null ? (
        <>
          <p className="hint">
            {results.length} candidate(s) match <strong>{query.trim()}</strong> across their CV text and name — the full
            talent pool, not just the last run.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Name &amp; contact</th><th>Match in CV</th><th>Applications</th><th>Last seen</th><th>CV</th></tr>
              </thead>
              <tbody>
                {results.map(h => (
                  <tr key={h.candidateId}>
                    <td>
                      <ContactCell candidateId={h.candidateId} name={h.name} email={h.email} phone={h.phone}
                        onSaved={() => void runSearch()} notify={notify} />
                    </td>
                    <td style={{ maxWidth: 460 }}><Snippet text={h.snippet} /></td>
                    <td className="sub">{h.applicationCount}</td>
                    <td className="sub">{h.lastSeen.slice(0, 10)}</td>
                    <td>
                      {h.lastCvPath && (
                        <button className="linklike" onClick={() => void call(avz.openFile(h.lastCvPath!), notify)}>Open</button>
                      )}
                    </td>
                  </tr>
                ))}
                {results.length === 0 && <tr><td colSpan={5} className="muted">No CVs match that search.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
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
      )}
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
