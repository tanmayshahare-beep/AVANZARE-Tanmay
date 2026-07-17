import { useEffect, useState } from 'react';
import { avz, call, type AuditEntry } from '../api';

interface Props {
  exportDir?: string;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

const ACTION_BADGE: Record<string, string> = {
  email_sent: 'ok',
  email_failed: 'danger',
  candidate_purged: 'danger',
  contact_edit: 'warn',
};

/**
 * Full audit trail: who did what, when, to whom — including which CV version
 * (path + hash) every email decision was based on. Built for GDPR/EEOC
 * discovery requests; the Excel export contains the complete log.
 */
export default function Audit({ exportDir, notify }: Props) {
  const [rows, setRows] = useState<AuditEntry[]>([]);

  useEffect(() => {
    void (async () => {
      const list = await call(avz.auditList(500), notify);
      if (list) setRows(list);
    })();
  }, [notify]);

  const exportTable = async () => {
    const res = await call(avz.exportTable({ kind: 'audit', suggestedName: 'audit-log.xlsx', exportDir }), notify);
    if (res?.saved) notify(`Exported to ${res.path}`, 'info');
  };

  return (
    <div className="panel">
      <h2>Audit trail</h2>
      <p className="hint">
        Every consequential action — screenings, emails (with the CV version used), contact edits, notes,
        tier changes, purges — recorded with the OS user who performed it. Showing the latest 500;
        the Excel export contains the full history.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="sub" style={{ whiteSpace: 'nowrap' }}>{r.time.replace('T', ' ').slice(0, 19)}</td>
                <td>{r.actor}</td>
                <td><span className={`badge ${ACTION_BADGE[r.action] ?? ''}`}>{r.action}</span></td>
                <td className="sub" style={{ maxWidth: 560, overflowWrap: 'anywhere' }}>{r.detail}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">No audited actions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={exportTable}>Export full log to Excel</button>
      </div>
    </div>
  );
}
