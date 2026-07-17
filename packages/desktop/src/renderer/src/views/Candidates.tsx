import { useEffect, useState } from 'react';
import { avz, call, type CandidateRecord } from '../api';

interface Props {
  exportDir?: string;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

/** The persistent talent database accumulated across screening runs. */
export default function Candidates({ exportDir, notify }: Props) {
  const [rows, setRows] = useState<CandidateRecord[]>([]);

  const refresh = async () => {
    const list = await call(avz.candidates.list(), notify);
    if (list) setRows(list);
  };
  useEffect(() => { void refresh(); }, []);

  const purge = async (c: CandidateRecord) => {
    if (!window.confirm(
      `Permanently delete ${c.name} (${c.email ?? 'no email'}) and all their application records?\n` +
      'Use this for data-deletion (GDPR) requests. This cannot be undone.')) return;
    await call(avz.candidates.purge(c.id), notify);
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
        Contact info of every applicant ever parsed, deduplicated by email. This is personal data —
        use “Delete” to honor erasure requests.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>First seen</th><th>Last seen</th><th>CV</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.email ?? <span className="badge warn">no email</span>}</td>
                <td>{c.phone ?? ''}</td>
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
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No candidates parsed yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={exportTable}>Export to Excel</button>
      </div>
    </div>
  );
}
