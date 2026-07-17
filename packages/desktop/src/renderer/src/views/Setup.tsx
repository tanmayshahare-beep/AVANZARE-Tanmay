import { useEffect, useState } from 'react';
import type { ConnectionTestResult, SettingsProfile } from '@avanzare/engine';
import { avz, call } from '../api';

interface Props {
  firstRun: boolean;
  current: SettingsProfile | null;
  onUse: (p: SettingsProfile) => void;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

function emptyProfile(): SettingsProfile {
  return {
    name: '',
    useAutomatically: false,
    source: { kind: 'local', path: '' },
    llm: { baseUrl: 'http://localhost:11434', model: '', timeoutMs: 120000 },
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', fromAddress: '', fromName: 'Recruiting Team' },
    templates: {
      rejectionSubject: 'Your application for {{job_title}}',
      rejectionBody: 'Dear {{name}},\n\nThank you for your interest in the {{job_title}} position. After careful review we will not be moving forward with your application at this time.\n\nWe appreciate the time you invested and encourage you to apply for future openings.\n\nBest regards',
      acceptanceSubject: 'Next steps for your {{job_title}} application',
      acceptanceBody: 'Dear {{name}},\n\nThank you for applying for the {{job_title}} position. We were impressed by your profile and would like to invite you to the next stage of the process. We will contact you shortly to arrange the details.\n\nBest regards',
    },
    concurrency: 4,
  };
}

/**
 * The Technical Setup screen. Shown before anything else on first run, and
 * reused as the "Technical Settings" tab afterwards — same component, so the
 * two can never drift apart.
 */
export default function Setup({ firstRun, current, onUse, notify }: Props) {
  const [saved, setSaved] = useState<SettingsProfile[]>([]);
  const [p, setP] = useState<SettingsProfile>(current ?? emptyProfile());
  const [saveProfile, setSaveProfile] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const [tests, setTests] = useState<ConnectionTestResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const list = await call(avz.profiles.list(), notify);
    if (list) setSaved(list);
  };
  useEffect(() => { void refresh(); }, []);

  const set = (patch: Partial<SettingsProfile>) => setP(prev => ({ ...prev, ...patch }));

  const pickFolder = async () => {
    const folder = await call(avz.pickFolder(), notify);
    if (folder) set({ source: { ...p.source, path: folder } });
  };

  const loadModels = async () => {
    setBusy(true);
    const list = await call(avz.listModels(p.llm), notify);
    setBusy(false);
    if (list) {
      setModels(list);
      if (list.length && !list.includes(p.llm.model)) set({ llm: { ...p.llm, model: list[0] } });
      notify(`${list.length} model(s) found on ${p.llm.baseUrl}`, 'info');
    }
  };

  const runTests = async () => {
    setBusy(true);
    setTests(null);
    const res = await call(avz.testConnections(p), notify);
    setBusy(false);
    if (res) setTests(res);
  };

  const useThis = async () => {
    if (!p.name.trim() && saveProfile) { notify('Give the profile a name before saving.'); return; }
    if (saveProfile) {
      const ok = await avz.profiles.save(p);
      if (!ok.ok) { notify(ok.error.message); return; }
      notify(`Profile "${p.name}" saved.`, 'info');
      void refresh();
    }
    onUse(p);
  };

  return (
    <>
      <div className="panel">
        <h2>{firstRun ? 'Technical Setup' : 'Technical Settings'}</h2>
        <p className="hint">
          {firstRun
            ? 'Before screening can start, tell AVANZARE where the CVs are, where the LLM runs, and how to send email.'
            : 'Changes apply to the current session; tick "save" to persist them to the profile.'}
        </p>

        {saved.length > 0 && (
          <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
            <span className="muted">Saved profiles:</span>
            {saved.map(sp => (
              <span key={sp.name}>
                <button className="btn small" onClick={() => { setP(sp); setTests(null); }}>{sp.name}</button>
                <button className="btn small danger" title={`Delete profile ${sp.name}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete profile "${sp.name}"?`)) return;
                    await call(avz.profiles.delete(sp.name), notify);
                    void refresh();
                  }}>×</button>
              </span>
            ))}
          </div>
        )}

        <h3>CV source</h3>
        <div className="grid3">
          <label className="field"><span>Local folder with CVs (.pdf / .docx / .doc)</span>
            <input type="text" value={p.source.path} placeholder="C:\HR\resumes"
              onChange={e => set({ source: { ...p.source, path: e.target.value } })} />
          </label>
          <label className="field"><span>&nbsp;</span>
            <button className="btn" onClick={pickFolder}>Browse…</button>
          </label>
          <label className="field"><span>Source type</span>
            <select value={p.source.kind}
              onChange={e => set({ source: { ...p.source, kind: e.target.value as 'local' | 'cloud' } })}>
              <option value="local">Local folder</option>
              <option value="cloud" disabled>Cloud (coming soon)</option>
            </select>
          </label>
        </div>

        <h3>LLM (Ollama)</h3>
        <div className="grid3">
          <label className="field"><span>Ollama base URL — local or another machine</span>
            <input type="url" value={p.llm.baseUrl} placeholder="http://localhost:11434"
              onChange={e => set({ llm: { ...p.llm, baseUrl: e.target.value } })} />
          </label>
          <label className="field"><span>Model</span>
            {models.length ? (
              <select value={p.llm.model} onChange={e => set({ llm: { ...p.llm, model: e.target.value } })}>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input type="text" value={p.llm.model} placeholder="e.g. llama3.1"
                onChange={e => set({ llm: { ...p.llm, model: e.target.value } })} />
            )}
          </label>
          <label className="field"><span>&nbsp;</span>
            <button className="btn" onClick={loadModels} disabled={busy}>Load models</button>
          </label>
        </div>

        <h3>Email (SMTP)</h3>
        <div className="grid3">
          <label className="field"><span>SMTP host</span>
            <input type="text" value={p.smtp.host} placeholder="smtp.company.com"
              onChange={e => set({ smtp: { ...p.smtp, host: e.target.value } })} />
          </label>
          <label className="field"><span>Port</span>
            <input type="number" value={p.smtp.port}
              onChange={e => set({ smtp: { ...p.smtp, port: Number(e.target.value) } })} />
          </label>
          <label className="field" style={{ justifyContent: 'end' }}>
            <span>&nbsp;</span>
            <span className="check"><input type="checkbox" checked={p.smtp.secure}
              onChange={e => set({ smtp: { ...p.smtp, secure: e.target.checked } })} /> TLS (port 465)</span>
          </label>
          <label className="field"><span>Username</span>
            <input type="text" value={p.smtp.user}
              onChange={e => set({ smtp: { ...p.smtp, user: e.target.value } })} />
          </label>
          <label className="field"><span>Password</span>
            <input type="password" value={p.smtp.pass}
              onChange={e => set({ smtp: { ...p.smtp, pass: e.target.value } })} />
          </label>
          <label className="field"><span>From address</span>
            <input type="text" value={p.smtp.fromAddress} placeholder="recruiting@company.com"
              onChange={e => set({ smtp: { ...p.smtp, fromAddress: e.target.value } })} />
          </label>
        </div>

        <h3>Email templates</h3>
        <p className="hint">Placeholders: {'{{name}}'} and {'{{job_title}}'}. "Acceptance" is the invitation to the next stage.</p>
        <div className="grid2">
          <label className="field"><span>Rejection subject</span>
            <input type="text" value={p.templates.rejectionSubject}
              onChange={e => set({ templates: { ...p.templates, rejectionSubject: e.target.value } })} />
          </label>
          <label className="field"><span>Acceptance subject</span>
            <input type="text" value={p.templates.acceptanceSubject}
              onChange={e => set({ templates: { ...p.templates, acceptanceSubject: e.target.value } })} />
          </label>
          <label className="field"><span>Rejection body</span>
            <textarea value={p.templates.rejectionBody}
              onChange={e => set({ templates: { ...p.templates, rejectionBody: e.target.value } })} />
          </label>
          <label className="field"><span>Acceptance body</span>
            <textarea value={p.templates.acceptanceBody}
              onChange={e => set({ templates: { ...p.templates, acceptanceBody: e.target.value } })} />
          </label>
        </div>

        <h3>Runtime</h3>
        <div className="grid3">
          <label className="field"><span>Max CVs processed in parallel (keep low on shared servers)</span>
            <input type="number" min={1} max={64} value={p.concurrency}
              onChange={e => set({ concurrency: Number(e.target.value) })} />
          </label>
        </div>

        {tests && (
          <div style={{ marginTop: 14 }}>
            {tests.map(t => (
              <div className="test-result" key={t.target}>
                <span className={t.ok ? 'ok-text' : 'danger-text'}>{t.ok ? '✓' : '✗'}</span>
                <strong>{t.target.toUpperCase()}</strong>
                <span>{t.message}</span>
                {t.errorCode && <span className="code danger-text">{t.errorCode}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 18 }}>
          <button className="btn" onClick={runTests} disabled={busy}>Test connections</button>
          <span className="spacer" style={{ flex: 1 }} />
          <label className="check">
            <input type="checkbox" checked={saveProfile} onChange={e => setSaveProfile(e.target.checked)} />
            Save this settings profile
          </label>
          {saveProfile && (
            <>
              <input type="text" style={{ width: 160 }} placeholder="Profile name" value={p.name}
                onChange={e => set({ name: e.target.value })} />
              <label className="check" title="Skip this screen on the next launch">
                <input type="checkbox" checked={p.useAutomatically}
                  onChange={e => set({ useAutomatically: e.target.checked })} />
                use automatically
              </label>
            </>
          )}
          <button className="btn primary" onClick={useThis}>
            {firstRun ? 'Continue →' : 'Apply settings'}
          </button>
        </div>
      </div>
    </>
  );
}
