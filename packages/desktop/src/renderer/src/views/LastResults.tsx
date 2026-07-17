import { useEffect, useState } from 'react';
import type { ApplicationRow } from '@avanzare/engine';
import { avz, call } from '../api';

interface Props {
  exportDir?: string;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

const TIER_LABEL: Record<string, { text: string; cls: string }> = {
  rejected: { text: 'rejected', cls: 'danger' },
  optional: { text: 'mandatory + optional', cls: 'ok' },
  mandatory: { text: 'mandatory only', cls: '' },
  rescued: { text: 'rescued', cls: 'warn' },
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'no decision yet',
  rejected_notified: 'rejected (emailed)',
  rejected_final: 'rejected',
  in_llm: 'analyzed, awaiting decision',
  accepted: 'accepted',
};

/**
 * The persistent Results tab: the most recent screening, read straight from the
 * database — survives tab switches and app restarts alike.
 */
export default function LastResults({ exportDir, notify }: Props) {
  const [data, setData] = useState<{ job: { id: number; title: string; createdAt: string }; applications: ApplicationRow[] } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    void (async () => {
      const res = await call(avz.lastJob(), notify);
      setData(res ?? null);
      setLoaded(true);
    })();
  }, [notify]);

  if (!loaded) return <div className="panel"><p className="muted">Loading…</p></div>;
  if (!data) {
    return (
      <div className="panel">
        <h2>Results</h2>
        <p className="hint">No screening has been run yet. Start one from the Screening tab — the latest results will stay available here.</p>
      </div>
    );
  }

  const rows = [...data.applications].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const analyzed = rows.filter(r => r.score !== null).length;

  const toggleExpand = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const exportTable = async () => {
    const res = await call(avz.exportTable({
      kind: analyzed > 0 ? 'results' : 'applications',
      applicationIds: rows.map(r => r.id),
      suggestedName: `screening-${data.job.title.replace(/\W+/g, '-')}.xlsx`,
      exportDir,
    }), notify);
    if (res?.saved) notify(`Exported to ${res.path}`, 'info');
  };

  return (
    <div className="panel">
      <h2>Last screening — {data.job.title}</h2>
      <p className="hint">
        Run on {data.job.createdAt.slice(0, 10)} · {rows.length} application(s), {analyzed} analyzed by the LLM.
        This view is stored in the local database and survives restarts.
      </p>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Contact info</th><th>Tier</th><th>Score /10</th><th>Reasoning</th><th>Status</th><th>CV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const tier = TIER_LABEL[r.tier] ?? { text: r.tier, cls: '' };
              const isOpen = expanded.has(r.id);
              const reasoning = r.reasoning ?? '';
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    {r.email ?? <span className="badge warn">no email found</span>}
                    {r.phone && <div className="sub">{r.phone}</div>}
                  </td>
                  <td><span className={`badge ${tier.cls}`}>{tier.text}</span></td>
                  <td><span className="score">{r.score !== null ? r.score.toFixed(1) : '—'}</span></td>
                  <td className="reasoning">
                    {reasoning && (
                      <span className="preview" onClick={() => toggleExpand(r.id)} title="Click to expand/collapse">
                        {isOpen || reasoning.length <= 90 ? reasoning : reasoning.slice(0, 90) + '… ▸'}
                      </span>
                    )}
                  </td>
                  <td><span className="sub">{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td>
                    <button className="linklike" onClick={() => void call(avz.openFile(r.cvPath), notify)}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="btn-row">
        <button className="btn" onClick={exportTable}>Export to Excel</button>
      </div>
    </div>
  );
}
