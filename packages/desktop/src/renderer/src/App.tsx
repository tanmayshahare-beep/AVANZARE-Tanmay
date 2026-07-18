import { useCallback, useEffect, useState } from 'react';
import type { ApplicationRow, ScreeningResult, SettingsProfile } from '@avanzare/engine';
import { avz, call } from './api';
import Setup from './views/Setup';
import Job, { buildScreeningInput, type JobDef } from './views/Job';
import Running from './views/Running';
import Rejection from './views/Rejection';
import Results from './views/Results';
import LastResults from './views/LastResults';
import Candidates from './views/Candidates';
import Audit from './views/Audit';
import Batch, { type BatchTask } from './views/Batch';

type Tab = 'screening' | 'batch' | 'results' | 'candidates' | 'audit' | 'settings';
type WizardStep = 'job' | 'running' | 'rejection' | 'analyzing' | 'results';

export interface Toast { text: string; kind: 'error' | 'info' }

function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light');
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('avz-theme', next);
    setTheme(next);
  };
  return (
    <button className="tab" onClick={flip} title="Toggle dark/light mode">
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </button>
  );
}

export default function App() {
  // Which top-level tab is open. Wizard state lives separately, so switching
  // tabs mid-screening and coming back loses nothing.
  const [tab, setTab] = useState<Tab>('settings');
  const [wizard, setWizard] = useState<WizardStep>('job');
  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [job, setJob] = useState<JobDef | null>(null);
  const [screening, setScreening] = useState<ScreeningResult | null>(null);
  const [results, setResults] = useState<ApplicationRow[]>([]);
  const [llmFailures, setLlmFailures] = useState<{ applicationId: number; code: string; message: string }[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  // Batch (multitasking) state — lives here so it survives tab switches and can hand a
  // completed task to the review wizard below.
  const [batchTasks, setBatchTasks] = useState<BatchTask[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMax, setBatchMax] = useState(2);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'error') => {
    setToast({ text, kind });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 9000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // On launch: auto-load the profile marked "use automatically", else show setup.
  useEffect(() => {
    void (async () => {
      const list = await call(avz.profiles.list(), notify);
      const auto = list?.find(p => p.useAutomatically);
      if (auto) { setProfile(auto); setTab('screening'); }
    })();
  }, [notify]);

  const useProfile = (p: SettingsProfile) => { setProfile(p); setTab('screening'); };

  const startScreening = async (def: JobDef) => {
    if (!profile) return;
    setJob(def);
    setWizard('running');
    const res = await call(avz.runScreening(buildScreeningInput(profile, def)),
      (m) => { notify(m); setWizard('job'); });
    if (res) { setScreening(res); setWizard('rejection'); }
  };

  // ---- Batch (multitasking) ----
  // Per-task progress and completion arrive on their own IPC channels while several
  // screenings run concurrently, so each task row updates independently.
  useEffect(() => {
    const offP = avz.onBatchProgress(({ taskId, progress }) => {
      setBatchTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'running', progress } : t));
    });
    const offD = avz.onBatchDone((r) => {
      setBatchTasks(prev => prev.map(t => {
        if (t.id !== r.taskId) return t;
        return r.ok
          ? { ...t, status: 'done', result: r.result, progress: undefined, error: undefined }
          : { ...t, status: 'error', error: r.error, progress: undefined };
      }));
    });
    return () => { offP(); offD(); };
  }, []);

  const addTask = (p: SettingsProfile, def: JobDef) =>
    setBatchTasks(prev => [...prev, { id: crypto.randomUUID(), profile: p, def, status: 'queued' }]);
  const updateTask = (id: string, p: SettingsProfile, def: JobDef) =>
    setBatchTasks(prev => prev.map(t => t.id === id ? { ...t, profile: p, def } : t));
  const removeTask = (id: string) => setBatchTasks(prev => prev.filter(t => t.id !== id));
  const clearFinished = () =>
    setBatchTasks(prev => prev.filter(t => t.status === 'queued' || t.status === 'running'));

  const runAll = async () => {
    const toRun = batchTasks.filter(t => t.status === 'queued' || t.status === 'error');
    if (!toRun.length) return;
    const ids = new Set(toRun.map(t => t.id));
    setBatchTasks(prev => prev.map(t => ids.has(t.id)
      ? { ...t, status: 'running', progress: undefined, result: undefined, error: undefined } : t));
    setBatchRunning(true);
    // The promise resolves once every task settles; per-task UI is driven by the events above.
    await call(avz.runBatch({
      tasks: toRun.map(t => ({ taskId: t.id, input: buildScreeningInput(t.profile, t.def) })),
      maxConcurrent: batchMax,
    }), notify);
    setBatchRunning(false);
  };

  /** Hand a finished batch task to the normal review wizard, driven by that task's own profile. */
  const reviewTask = (task: BatchTask) => {
    if (!task.result) return;
    setProfile(task.profile);
    setJob(task.def);
    setScreening(task.result);
    setResults([]); setLlmFailures([]);
    setWizard('rejection');
    setTab('screening');
  };

  /** After the rejection screen: rescue unchecked, then run LLM over accepted + rescued. */
  const continueToAnalysis = async (rescuedIds: number[]) => {
    if (!profile || !screening) return;
    if (rescuedIds.length) await call(avz.setTier(rescuedIds, 'rescued'), notify);
    const ids = [
      ...screening.acceptedMandatory.map(a => a.id),
      ...screening.acceptedOptional.map(a => a.id),
      ...rescuedIds,
    ];
    if (!ids.length) { notify('No applications to analyze — every CV was rejected.', 'info'); setWizard('job'); return; }
    setWizard('analyzing');
    const res = await call(avz.analyze({ jobId: screening.jobId, applicationIds: ids, profile }),
      (m) => { notify(m); setWizard('rejection'); });
    if (res) {
      setResults(res.rows);
      setLlmFailures(res.failures);
      setWizard('results');
    }
  };

  const restart = () => {
    setJob(null); setScreening(null); setResults([]); setLlmFailures([]); setWizard('job');
    setTab('screening');
  };

  // The results views carry a wide, many-column table — give them extra room.
  const wideView = tab === 'results' || (tab === 'screening' && wizard === 'results');

  return (
    <>
      <div className="topbar">
        <span className="brand">AVANZARE</span>
        <button className={`tab ${tab === 'screening' ? 'active' : ''}`} disabled={!profile}
          onClick={() => setTab('screening')}>Screening</button>
        <button className={`tab ${tab === 'batch' ? 'active' : ''}`}
          onClick={() => setTab('batch')}>Batch{batchRunning ? ' ●' : ''}</button>
        <button className={`tab ${tab === 'results' ? 'active' : ''}`}
          onClick={() => setTab('results')}>Results</button>
        <button className={`tab ${tab === 'candidates' ? 'active' : ''}`} disabled={!profile}
          onClick={() => setTab('candidates')}>Candidates</button>
        <button className={`tab ${tab === 'audit' ? 'active' : ''}`}
          onClick={() => setTab('audit')}>Audit</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}>Technical Settings</button>
        <span className="spacer" />
        {profile && <span className="profile-chip">profile: {profile.name || '(unsaved)'}</span>}
        <ThemeToggle />
      </div>

      <div className="main"><div className={`container${wideView ? ' wide' : ''}`}>
        {tab === 'settings' && (
          <Setup firstRun={!profile} current={profile} onUse={useProfile} notify={notify} />
        )}

        {tab === 'screening' && profile && (
          <>
            {wizard === 'job' && <Job profile={profile} initial={job} onStart={startScreening} />}
            {wizard === 'running' && <Running label="Parsing CVs" />}
            {wizard === 'rejection' && screening && job && (
              <Rejection screening={screening} jobTitle={job.title} profile={profile}
                notify={notify} onContinue={continueToAnalysis} />
            )}
            {wizard === 'analyzing' && <Running label="LLM analysis in progress" />}
            {wizard === 'results' && screening && job && (
              <Results rows={results} failures={llmFailures} jobId={screening.jobId}
                jobTitle={job.title} profile={profile} target={job.targetAcceptances}
                notify={notify} onDone={restart} />
            )}
          </>
        )}

        {tab === 'batch' && (
          <Batch tasks={batchTasks} running={batchRunning} maxConcurrent={batchMax}
            onMaxConcurrent={setBatchMax} onAdd={addTask} onUpdate={updateTask} onRemove={removeTask}
            onRunAll={runAll} onReview={reviewTask} onClearFinished={clearFinished} notify={notify} />
        )}

        {tab === 'results' && <LastResults exportDir={profile?.exportDir} notify={notify} />}
        {tab === 'candidates' && <Candidates exportDir={profile?.exportDir} notify={notify} />}
        {tab === 'audit' && <Audit exportDir={profile?.exportDir} notify={notify} />}
      </div></div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </>
  );
}
