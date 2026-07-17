import { useCallback, useEffect, useState } from 'react';
import type { ApplicationRow } from '@avanzare/engine';
import { avz, call, type JobMetrics } from '../api';
import ContactCell from '../components/ContactCell';
import HistoryCell from '../components/HistoryCell';
import CvDrawer, { type CvDrawerTarget } from '../components/CvDrawer';
import CriteriaBadges from '../components/CriteriaBadges';
import EducationCell from '../components/EducationCell';
import CompareModal from '../components/CompareModal';

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

function Tile({ num, label }: { num: number; label: string }) {
  return (
    <div className="tile">
      <div className="num">{num}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

/**
 * Results tab: any past screening (default: the most recent), read straight from
 * the database — survives tab switches and app restarts. Includes the job
 * performance dashboard: hiring funnel + which keywords did the filtering work.
 */
export default function LastResults({ exportDir, notify }: Props) {
  const [jobs, setJobs] = useState<{ id: number; title: string; createdAt: string }[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<JobMetrics | null>(null);
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [drawer, setDrawer] = useState<CvDrawerTarget | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const list = await call(avz.jobs(), notify);
      setJobs(list ?? []);
      if (list?.length) setJobId(list[0].id);
      setLoaded(true);
    })();
  }, [notify]);

  const loadJob = useCallback(async (id: number) => {
    const [m, apps] = await Promise.all([
      call(avz.jobMetrics(id), notify),
      call(avz.jobApplications(id), notify),
    ]);
    if (m) setMetrics(m);
    setRows(apps ? [...apps].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : []);
    setSelected(new Set());
  }, [notify]);

  const toggleSelect = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useEffect(() => { if (jobId !== null) void loadJob(jobId); }, [jobId, loadJob]);

  if (!loaded) return <div className="panel"><p className="muted">Loading…</p></div>;
  if (!jobs.length) {
    return (
      <div className="panel">
        <h2>Results</h2>
        <p className="hint">No screening has been run yet. Start one from the Screening tab — every run stays available here.</p>
      </div>
    );
  }

  const analyzed = rows.filter(r => r.score !== null).length;
  const toggleExpand = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const exportTable = async () => {
    const job = jobs.find(j => j.id === jobId);
    const res = await call(avz.exportTable({
      kind: analyzed > 0 ? 'results' : 'applications',
      applicationIds: rows.map(r => r.id),
      suggestedName: `screening-${(job?.title ?? 'job').replace(/\W+/g, '-')}.xlsx`,
      exportDir,
    }), notify);
    if (res?.saved) notify(`Exported to ${res.path}`, 'info');
  };

  const f = metrics?.funnel;
  const maxMissing = Math.max(1, ...(metrics?.mandatoryImpact.map(k => k.missingCount) ?? [1]));

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>Screening results</h2>
          <select value={jobId ?? ''} onChange={e => setJobId(Number(e.target.value))} style={{ width: 'auto' }}>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.createdAt.slice(0, 10)} — {j.title}</option>)}
          </select>
        </div>

        {f && (
          <>
            <h3>Hiring funnel</h3>
            <div className="tiles">
              <Tile num={f.applied} label="applied" />
              <Tile num={f.keywordRejected} label="rejected at keyword stage" />
              <Tile num={f.rescued} label="of those rescued" />
              <Tile num={f.analyzed} label="analyzed by LLM" />
              <Tile num={f.accepted} label="accepted" />
              <Tile num={f.rejectedFinal} label="rejected total" />
              {f.pending > 0 && <Tile num={f.pending} label="awaiting decision" />}
            </div>
          </>
        )}

        {metrics && metrics.mandatoryImpact.length > 0 && (
          <>
            <h3>Which mandatory keywords filtered the most candidates</h3>
            <div className="tablewrap"><table>
              <thead><tr><th>Keyword</th><th>Rejects missing it</th><th /></tr></thead>
              <tbody>
                {metrics.mandatoryImpact.map(k => (
                  <tr key={k.keyword}>
                    <td><span className="badge">{k.keyword}</span></td>
                    <td>{k.missingCount}</td>
                    <td style={{ width: '50%' }}>
                      <span className="kwbar" style={{ width: `${(k.missingCount / maxMissing) * 100}%`, minWidth: k.missingCount ? 4 : 0 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="hint">A keyword that rejects almost everyone may be phrased too narrowly (e.g. "Amazon Web Services" vs "AWS").</p>
          </>
        )}

        {metrics && metrics.optionalCorrelation.length > 0 && analyzed > 0 && (
          <>
            <h3>Optional keywords vs LLM score</h3>
            <div className="tablewrap"><table>
              <thead><tr><th>Keyword</th><th>CVs with it</th><th>Avg score with</th><th>Avg score without</th></tr></thead>
              <tbody>
                {metrics.optionalCorrelation.map(k => (
                  <tr key={k.keyword}>
                    <td><span className="badge ok">{k.keyword}</span></td>
                    <td>{k.withCount}</td>
                    <td><span className="score" style={{ fontSize: 13 }}>{k.withAvg !== null ? k.withAvg.toFixed(1) : '—'}</span></td>
                    <td>{k.withoutAvg !== null ? k.withoutAvg.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="hint">Keywords whose "with" average clearly beats "without" are good candidates for promotion to mandatory next round.</p>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Applications</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Name &amp; contact</th><th>History &amp; notes</th><th>Tier</th><th>Score /100</th><th>Education</th><th>Requirements</th><th>Reasoning</th><th>Status</th><th>CV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const tier = TIER_LABEL[r.tier] ?? { text: r.tier, cls: '' };
                const isOpen = expanded.has(r.id);
                const reasoning = r.reasoning ?? '';
                return (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)}
                      title="Select to compare" /></td>
                    <td>
                      <button className="linklike" style={{ fontWeight: 600 }}
                        onClick={() => setDrawer({ applicationId: r.id, name: r.name, cvPath: r.cvPath })}>
                        {r.name}
                      </button>
                      <ContactCell candidateId={r.candidateId} name={r.name} email={r.email} phone={r.phone}
                        onSaved={v => setRows(prev => prev.map(x => x.id === r.id ? { ...x, ...v } : x))} notify={notify} />
                    </td>
                    <td>
                      <HistoryCell candidateId={r.candidateId} priorCount={r.priorCount}
                        currentJobId={r.jobId} notify={notify} />
                      {r.notes && <div className="notes-preview">{r.notes}</div>}
                    </td>
                    <td><span className={`badge ${tier.cls}`}>{tier.text}</span></td>
                    <td><span className="score">{r.score !== null ? Math.round(r.score) : '—'}</span></td>
                    <td><EducationCell verdict={r.education} /></td>
                    <td><CriteriaBadges verdict={r.criteria} /></td>
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
          <button className="btn" disabled={selected.size < 2} onClick={() => setCompareOpen(true)}
            title="Tick 2 or more rows to compare them side by side">
            Compare selected ({selected.size})
          </button>
          <button className="btn" onClick={exportTable}>Export to Excel</button>
        </div>
      </div>

      <CvDrawer target={drawer} onClose={() => setDrawer(null)} notify={notify} />
      {compareOpen && (
        <CompareModal
          rows={rows.filter(r => selected.has(r.id))}
          jobTitle={jobs.find(j => j.id === jobId)?.title ?? 'screening'}
          notify={notify}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </>
  );
}
