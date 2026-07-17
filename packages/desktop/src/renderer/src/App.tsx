import { useCallback, useEffect, useState } from 'react';
import type { ApplicationRow, ScreeningResult, SettingsProfile } from '@avanzare/engine';
import { avz, call } from './api';
import Setup from './views/Setup';
import Job, { type JobDef } from './views/Job';
import Running from './views/Running';
import Rejection from './views/Rejection';
import Results from './views/Results';
import LastResults from './views/LastResults';
import Candidates from './views/Candidates';
import Audit from './views/Audit';

type Tab = 'screening' | 'results' | 'candidates' | 'audit' | 'settings';
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
    const res = await call(avz.runScreening({
      jobTitle: def.title,
      prompt: def.prompt,
      mandatoryKeywords: def.mandatory,
      optionalKeywords: def.optional,
      keywordSynonyms: def.keywordSynonyms,
      criteria: def.criteria,
      targetAcceptances: def.targetAcceptances,
      sourcePath: profile.source.path,
      ocr: profile.ocr,
      concurrency: profile.concurrency,
    }), (m) => { notify(m); setWizard('job'); });
    if (res) { setScreening(res); setWizard('rejection'); }
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

        {tab === 'results' && <LastResults exportDir={profile?.exportDir} notify={notify} />}
        {tab === 'candidates' && <Candidates exportDir={profile?.exportDir} notify={notify} />}
        {tab === 'audit' && <Audit exportDir={profile?.exportDir} notify={notify} />}
      </div></div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </>
  );
}
