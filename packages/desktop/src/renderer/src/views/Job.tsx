import { useState } from 'react';
import type { SettingsProfile, WeightedKeyword } from '@avanzare/engine';

export interface JobDef {
  title: string;
  mandatory: WeightedKeyword[];
  optional: string[];
  prompt: string;
}

interface Props {
  profile: SettingsProfile;
  initial: JobDef | null;
  onStart: (def: JobDef) => void;
}

const PROMPT_NUDGE = 200;

function parseKeywords(s: string): string[] {
  return [...new Set(s.split(/[,\n;]+/).map(x => x.trim()).filter(Boolean))];
}

export default function Job({ profile, initial, onStart }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [mandatory, setMandatory] = useState(initial?.mandatory.map(k => k.keyword).join(', ') ?? '');
  const [optional, setOptional] = useState(initial?.optional.join(', ') ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  // keyword → importance (1-5); keywords not in the map default to 3
  const [importance, setImportance] = useState<Record<string, number>>(() =>
    Object.fromEntries((initial?.mandatory ?? []).map(k => [k.keyword, k.importance])));

  const mandNames = parseKeywords(mandatory);
  const opt = parseKeywords(optional);
  const ready = title.trim() && mandNames.length > 0 && prompt.trim().length > 0;

  const weighted: WeightedKeyword[] = mandNames.map(k => ({ keyword: k, importance: importance[k] ?? 3 }));

  return (
    <div className="panel">
      <h2>New screening</h2>
      <p className="hint">CVs will be read from <strong>{profile.source.path}</strong> (change under Technical Settings).</p>

      <div className="grid2">
        <label className="field"><span>Job title</span>
          <input type="text" value={title} placeholder="e.g. Senior Backend Engineer"
            onChange={e => setTitle(e.target.value)} />
        </label>
        <span />
        <label className="field">
          <span>Mandatory keywords — a CV missing any of these is rejected</span>
          <input type="text" value={mandatory} placeholder="Python, AWS"
            onChange={e => setMandatory(e.target.value)} />
        </label>
        <label className="field">
          <span>Additional keywords — nice-to-haves that raise a CV's tier</span>
          <input type="text" value={optional} placeholder="Kubernetes, Terraform"
            onChange={e => setOptional(e.target.value)} />
        </label>
      </div>

      {mandNames.length > 0 && (
        <>
          <p className="hint" style={{ marginBottom: 4 }}>
            Set each keyword's <strong>importance (1–5)</strong>. On the rejection screen every applicant gets a
            keyword score out of 5 — matched keywords earn their importance as marks — so you can spot near-misses worth rescuing.
          </p>
          <div className="btn-row" style={{ marginTop: 4 }}>
            {mandNames.map(k => (
              <span key={k} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px' }}>
                {k}
                <select value={importance[k] ?? 3} style={{ width: 'auto', padding: '1px 4px', fontSize: 12 }}
                  title={`Importance of "${k}" (1 = nice, 5 = critical)`}
                  onChange={e => setImportance(prev => ({ ...prev, [k]: Number(e.target.value) }))}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </span>
            ))}
            {opt.length > 0 && <>optional: {opt.map(k => <span className="badge ok" key={k}>{k}</span>)}</>}
          </div>
        </>
      )}

      <label className="field" style={{ marginTop: 12 }}>
        <span>Job description for the LLM</span>
        <textarea rows={8} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="Describe the role in detail: responsibilities, must-have experience, seniority, team context, domain… The more specific you are, the better the LLM can judge fit." />
      </label>
      {prompt.trim().length > 0 && prompt.trim().length < PROMPT_NUDGE && (
        <p className="hint" style={{ color: 'var(--warn)' }}>
          Tip: this description is quite short ({prompt.trim().length} characters). A detailed description — responsibilities,
          required experience, seniority — noticeably improves how well the LLM ranks candidates.
        </p>
      )}

      <div className="btn-row">
        <button className="btn primary" disabled={!ready}
          onClick={() => onStart({ title: title.trim(), mandatory: weighted, optional: opt, prompt: prompt.trim() })}>
          Start parsing
        </button>
        {!ready && <span className="muted">Job title, at least one mandatory keyword and a description are required.</span>}
      </div>
    </div>
  );
}
