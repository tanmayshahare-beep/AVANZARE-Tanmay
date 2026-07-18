import { useState, type ReactNode } from 'react';
import type { JobCriteria, KeywordSynonym, ScreeningInput, SettingsProfile, WeightedKeyword } from '@avanzare/engine';

/**
 * Assemble the engine's ScreeningInput from a technical profile (connection/runtime
 * config) and a job definition (keywords/prompt). Shared by the single-run wizard and
 * the batch runner so both build the input identically.
 */
export function buildScreeningInput(profile: SettingsProfile, def: JobDef): ScreeningInput {
  return {
    jobTitle: def.title,
    prompt: def.prompt,
    mandatoryKeywords: def.mandatory,
    optionalKeywords: def.optional,
    keywordSynonyms: def.keywordSynonyms,
    criteria: def.criteria,
    targetAcceptances: def.targetAcceptances,
    sourcePath: profile.source.path,
    ...(profile.source.kind === 'email' ? {
      emailImap: profile.source.imap,
      emailDateFrom: def.emailDateFrom,
      emailDateTo: def.emailDateTo,
    } : {}),
    ocr: profile.ocr,
    concurrency: profile.concurrency,
  };
}

export interface JobDef {
  title: string;
  mandatory: WeightedKeyword[];
  optional: string[];
  /** Alternative spellings that broaden keyword matching. */
  keywordSynonyms: KeywordSynonym[];
  criteria: JobCriteria;
  /** How many candidates the recruiter intends to hire; null = no target. */
  targetAcceptances: number | null;
  /** Email source only: inclusive date range of applications to import (yyyy-mm-dd). */
  emailDateFrom?: string;
  emailDateTo?: string;
  prompt: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

interface Props {
  profile: SettingsProfile;
  initial: JobDef | null;
  onStart: (def: JobDef) => void;
  /** Override the panel heading (e.g. "Add task to batch"). */
  heading?: string;
  /** Override the submit-button label (e.g. "Save task"). */
  submitLabel?: string;
  /** Optional extra content rendered above the job title (e.g. a profile picker in batch mode). */
  children?: ReactNode;
}

const PROMPT_NUDGE = 200;

function parseKeywords(s: string): string[] {
  return [...new Set(s.split(/[,\n;]+/).map(x => x.trim()).filter(Boolean))];
}

export default function Job({ profile, initial, onStart, heading, submitLabel, children }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [mandatory, setMandatory] = useState(initial?.mandatory.map(k => k.keyword).join(', ') ?? '');
  const [optional, setOptional] = useState(initial?.optional.join(', ') ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [target, setTarget] = useState(initial?.targetAcceptances?.toString() ?? '');
  const isEmail = profile.source.kind === 'email';
  const [dateFrom, setDateFrom] = useState(
    initial?.emailDateFrom ?? isoDay(new Date(Date.now() - 30 * 864e5)));
  const [dateTo, setDateTo] = useState(initial?.emailDateTo ?? isoDay(new Date()));
  // keyword → importance (1-5); keywords not in the map default to 3
  const [importance, setImportance] = useState<Record<string, number>>(() =>
    Object.fromEntries((initial?.mandatory ?? []).map(k => [k.keyword, k.importance])));
  // keyword → comma-separated alias string (alternative spellings that also count)
  const [aliases, setAliases] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.keywordSynonyms ?? []).map(s => [s.canonical, s.aliases.join(', ')])));
  // Requirement tags — each optional; assessed by the LLM with per-tag verdicts
  const [certs, setCerts] = useState(initial?.criteria.certifications.join(', ') ?? '');
  const [expMin, setExpMin] = useState(initial?.criteria.experienceMinYears?.toString() ?? '');
  const [expMax, setExpMax] = useState(initial?.criteria.experienceMaxYears?.toString() ?? '');
  const [pubField, setPubField] = useState(initial?.criteria.publicationsField ?? '');

  const mandNames = parseKeywords(mandatory);
  const opt = parseKeywords(optional);
  const emailRangeInvalid = isEmail && (!dateFrom || !dateTo || dateFrom > dateTo);
  const ready = title.trim() && mandNames.length > 0 && prompt.trim().length > 0 && !emailRangeInvalid;

  const weighted: WeightedKeyword[] = mandNames.map(k => ({ keyword: k, importance: importance[k] ?? 3 }));

  // Build synonym groups for any keyword (mandatory or optional) that has aliases typed.
  const allKeywords = [...mandNames, ...opt];
  const keywordSynonyms: KeywordSynonym[] = allKeywords
    .map(k => ({ canonical: k, aliases: parseKeywords(aliases[k] ?? '') }))
    .filter(s => s.aliases.length > 0);

  const parseYears = (s: string): number | null => {
    const n = Number(s.trim());
    return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const criteria: JobCriteria = {
    certifications: parseKeywords(certs),
    experienceMinYears: parseYears(expMin),
    experienceMaxYears: parseYears(expMax),
    publicationsField: pubField.trim(),
  };
  const rangeInvalid = criteria.experienceMinYears !== null && criteria.experienceMaxYears !== null
    && criteria.experienceMinYears > criteria.experienceMaxYears;

  const targetAcceptances = ((): number | null => {
    const n = Number(target.trim());
    return target.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
  })();

  return (
    <div className="panel">
      <h2>{heading ?? 'New screening'}</h2>
      {children}
      {isEmail ? (
        <>
          <p className="hint">
            Applications will be fetched from the mailbox <strong>{profile.source.imap?.host}/{profile.source.imap?.mailbox || 'INBOX'}</strong>{' '}
            (change under Technical Settings). Choose the date range of applications to import:
          </p>
          <div className="grid3">
            <label className="field"><span>From (received on/after)</span>
              <input type="date" value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)} />
            </label>
            <label className="field"><span>To (received on/before)</span>
              <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} />
            </label>
            <span />
          </div>
          {emailRangeInvalid && <p className="hint" style={{ color: 'var(--danger)' }}>Pick a valid date range (from ≤ to).</p>}
        </>
      ) : (
        <p className="hint">CVs will be read from <strong>{profile.source.path}</strong> (change under Technical Settings).</p>
      )}

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

      {allKeywords.length > 0 && (
        <>
          <h3>Keyword synonyms</h3>
          <p className="hint">
            Optional. Alternative spellings that should <strong>also</strong> count as a match for a keyword — so
            "AWS" isn't rejected because a CV wrote "Amazon Web Services". Comma-separate the alternatives; the
            keyword itself is always matched, and the original keyword is what's recorded.
          </p>
          <div className="grid2">
            {allKeywords.map(k => (
              <label className="field" key={k}>
                <span>{k} — also match</span>
                <input type="text" value={aliases[k] ?? ''} placeholder="e.g. Amazon Web Services, AWS Cloud"
                  onChange={e => setAliases(prev => ({ ...prev, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
        </>
      )}

      <h3>Hiring target</h3>
      <p className="hint">
        Optional. How many candidates you intend to hire. If fewer applicants clear the mandatory keywords than
        this, the rejection screen tells you how many short you are so you can rescue near-misses.
      </p>
      <div className="grid3">
        <label className="field"><span>Number of candidates to hire (optional)</span>
          <input type="number" min={1} value={target} placeholder="e.g. 15"
            onChange={e => setTarget(e.target.value)} />
        </label>
      </div>

      <h3>Requirement tags</h3>
      <p className="hint">
        Optional structured requirements assessed by the LLM — each analyzed candidate gets a ✓/✗ verdict
        per tag in the results table. Be exact: name the certification precisely, and the specific field for publications.
      </p>
      <div className="grid3">
        <label className="field"><span>Certifications (all required, comma-separated)</span>
          <input type="text" value={certs} placeholder="e.g. AWS Certified Solutions Architect, PMP"
            onChange={e => setCerts(e.target.value)} />
        </label>
        <label className="field"><span>Experience range (years, either side optional)</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="number" min={0} value={expMin} placeholder="min" onChange={e => setExpMin(e.target.value)} />
            <span className="muted">to</span>
            <input type="number" min={0} value={expMax} placeholder="max" onChange={e => setExpMax(e.target.value)} />
          </div>
        </label>
        <label className="field"><span>Research publications in field</span>
          <input type="text" value={pubField} placeholder="e.g. machine learning"
            onChange={e => setPubField(e.target.value)} />
        </label>
      </div>
      {rangeInvalid && (
        <p className="hint" style={{ color: 'var(--danger)' }}>Experience range: minimum is greater than maximum.</p>
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
        <button className="btn primary" disabled={!ready || rangeInvalid}
          onClick={() => onStart({
            title: title.trim(), mandatory: weighted, optional: opt, keywordSynonyms, criteria, targetAcceptances,
            ...(isEmail ? { emailDateFrom: dateFrom, emailDateTo: dateTo } : {}),
            prompt: prompt.trim(),
          })}>
          {submitLabel ?? 'Start parsing'}
        </button>
        {!ready && <span className="muted">Job title, at least one mandatory keyword and a description are required.</span>}
      </div>
    </div>
  );
}
