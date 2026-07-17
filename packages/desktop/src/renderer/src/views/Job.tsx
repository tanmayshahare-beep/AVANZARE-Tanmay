import { useState } from 'react';
import type { SettingsProfile } from '@avanzare/engine';

export interface JobDef {
  title: string;
  mandatory: string[];
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
  const [mandatory, setMandatory] = useState(initial?.mandatory.join(', ') ?? '');
  const [optional, setOptional] = useState(initial?.optional.join(', ') ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');

  const mand = parseKeywords(mandatory);
  const opt = parseKeywords(optional);
  const ready = title.trim() && mand.length > 0 && prompt.trim().length > 0;

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
      {mand.length > 0 && (
        <p className="hint">Parsed: {mand.map(k => <span className="badge" key={k} style={{ marginRight: 4 }}>{k}</span>)}
          {opt.length > 0 && <> + optional: {opt.map(k => <span className="badge ok" key={k} style={{ marginRight: 4 }}>{k}</span>)}</>}
        </p>
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
        <button className="btn primary" disabled={!ready} onClick={() => onStart({ title: title.trim(), mandatory: mand, optional: opt, prompt: prompt.trim() })}>
          Start parsing
        </button>
        {!ready && <span className="muted">Job title, at least one mandatory keyword and a description are required.</span>}
      </div>
    </div>
  );
}
