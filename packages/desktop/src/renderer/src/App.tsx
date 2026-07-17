import { useCallback, useEffect, useState } from 'react';
import type { ApplicationRow, ScreeningResult, SettingsProfile } from '@avanzare/engine';
import { avz, call } from './api';
import Setup from './views/Setup';
import Job, { type JobDef } from './views/Job';
import Running from './views/Running';
import Rejection from './views/Rejection';
import Results from './views/Results';
import Candidates from './views/Candidates';

type View = 'setup' | 'job' | 'running' | 'rejection' | 'analyzing' | 'results' | 'settings' | 'candidates';

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
  const [view, setView] = useState<View>('setup');
  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [job, setJob] = useState<JobDef | null>(null);
  const [screening, setScreening] = useState<ScreeningResult | null>(null);
  const [results, setResults] = useState<ApplicationRow[]>([]);
  const [llmFailures, setLlmFailures] = useState<{ applicationId: number; code: string; message: string }[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'error') => {
    setToast({ text, kind });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), kindTimeout(toast.kind));
    return () => clearTimeout(t);
  }, [toast]);

  // On launch: auto-load the profile marked "use automatically", else show setup.
  useEffect(() => {
    void (async () => {
      const list = await call(avz.profiles.list(), notify);
      const auto = list?.find(p => p.useAutomatically);
      if (auto) { setProfile(auto); setView('job'); }
    })();
  }, [notify]);

  const useProfile = (p: SettingsProfile) => { setProfile(p); setView('job'); };

  const startScreening = async (def: JobDef) => {
    if (!profile) return;
    setJob(def);
    setView('running');
    const res = await call(avz.runScreening({
      jobTitle: def.title,
      prompt: def.prompt,
      mandatoryKeywords: def.mandatory,
      optionalKeywords: def.optional,
      sourcePath: profile.source.path,
      concurrency: profile.concurrency,
    }), (m) => { notify(m); setView('job'); });
    if (res) { setScreening(res); setView('rejection'); }
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
    if (!ids.length) { notify('No applications to analyze — every CV was rejected.', 'info'); setView('job'); return; }
    setView('analyzing');
    const res = await call(avz.analyze({ jobId: screening.jobId, applicationIds: ids, profile }),
      (m) => { notify(m); setView('rejection'); });
    if (res) {
      setResults(res.rows);
      setLlmFailures(res.failures);
      setView('results');
    }
  };

  const restart = () => { setJob(null); setScreening(null); setResults([]); setLlmFailures([]); setView('job'); };

  const inWizard = view === 'job' || view === 'running' || view === 'rejection' || view === 'analyzing' || view === 'results';

  return (
    <>
      <div className="topbar">
        <span className="brand">AVANZARE</span>
        <button className="tab" disabled={!profile} onClick={restart}
          style={inWizard ? { fontWeight: 600 } : undefined}>Screening</button>
        <button className={`tab ${view === 'candidates' ? 'active' : ''}`} disabled={!profile}
          onClick={() => setView('candidates')}>Candidates</button>
        <button className={`tab ${view === 'settings' || view === 'setup' ? 'active' : ''}`}
          onClick={() => setView(profile ? 'settings' : 'setup')}>Technical Settings</button>
        <span className="spacer" />
        {profile && <span className="profile-chip">profile: {profile.name || '(unsaved)'}</span>}
        <ThemeToggle />
      </div>

      <div className="main"><div className="container">
        {(view === 'setup' || view === 'settings') && (
          <Setup
            firstRun={view === 'setup'}
            current={profile}
            onUse={useProfile}
            notify={notify}
          />
        )}
        {view === 'job' && profile && <Job profile={profile} initial={job} onStart={startScreening} />}
        {view === 'running' && <Running label="Parsing CVs" />}
        {view === 'rejection' && screening && job && profile && (
          <Rejection
            screening={screening}
            jobTitle={job.title}
            profile={profile}
            notify={notify}
            onContinue={continueToAnalysis}
          />
        )}
        {view === 'analyzing' && <Running label="LLM analysis in progress" />}
        {view === 'results' && screening && job && profile && (
          <Results
            rows={results}
            failures={llmFailures}
            jobId={screening.jobId}
            jobTitle={job.title}
            profile={profile}
            notify={notify}
            onDone={restart}
          />
        )}
        {view === 'candidates' && <Candidates notify={notify} />}
      </div></div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </>
  );
}

function kindTimeout(kind: Toast['kind']): number {
  return kind === 'error' ? 9000 : 4000;
}
