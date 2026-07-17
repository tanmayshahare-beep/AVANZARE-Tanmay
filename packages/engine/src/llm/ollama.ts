import { AppError } from '../errors';
import type { CriteriaVerdict, EducationVerdict, JobCriteria, LlmSettings } from '../types';
import { CRITERIA_SCHEMA_PROPERTIES, criteriaPrompt, evaluateCriteria, type RawCriteriaFields } from './criteria';
import { EDUCATION_SCHEMA_PROPERTIES, educationPrompt, evaluateEducation, type RawEducationFields } from './education';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', minimum: 0, maximum: 100 },
    reasoning: { type: 'string' },
    ...CRITERIA_SCHEMA_PROPERTIES,
    ...EDUCATION_SCHEMA_PROPERTIES,
  },
  required: ['score', 'reasoning', 'education_score'],
} as const;

/** Scoring rubric shared by both providers: 0-100, spread out, education weighted in. */
export const SCORING_SYSTEM_PROMPT =
  'You are an experienced technical recruiter. Score how well the candidate\'s CV fits the job description on a ' +
  'scale of 0 to 100, and use the FULL range so strong and weak candidates are clearly separated:\n' +
  '- 85-100: an excellent, closely aligned fit — the core required skills/experience are clearly evidenced.\n' +
  '- 65-84: a good fit with minor gaps.\n' +
  '- 40-64: a partial fit — some relevant strengths but notable gaps.\n' +
  '- 0-39: a weak fit — little of what the role needs.\n' +
  'Be discriminating: reward candidates whose experience genuinely aligns with the role rather than clustering ' +
  'everyone in the middle. Weigh formal education into the score as described below. ' +
  'Respond with JSON: "score" (0-100, one decimal allowed), "reasoning" (one concise paragraph naming the ' +
  'concrete strengths and gaps that drove the score), plus the requested requirement and education fields.';

// Local models have finite context; a CV longer than this is truncated with a marker.
const MAX_CV_CHARS = 14_000;

async function ollamaFetch(settings: LlmSettings, apiPath: string, body?: unknown): Promise<unknown> {
  const url = new URL(apiPath, settings.baseUrl).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    throw new AppError(isTimeout ? 'AVZ-LLM-204' : 'AVZ-LLM-201', url, err instanceof Error ? err.message : String(err), err);
  }
  if (res.status === 404 && apiPath.includes('chat')) {
    throw new AppError('AVZ-LLM-202', url, `model "${settings.model}"`);
  }
  if (!res.ok) {
    throw new AppError('AVZ-LLM-201', url, `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/** List model names available on the endpoint (populates the setup dropdown). */
export async function ollamaListModels(settings: LlmSettings): Promise<string[]> {
  const data = await ollamaFetch(settings, '/api/tags') as { models?: { name: string }[] };
  return (data.models ?? []).map(m => m.name);
}

export async function ollamaTestConnection(settings: LlmSettings): Promise<void> {
  const models = await ollamaListModels(settings);
  if (settings.model && !models.includes(settings.model)) {
    throw new AppError('AVZ-LLM-202', settings.baseUrl, `model "${settings.model}" not in [${models.join(', ')}]`);
  }
}

export async function ollamaScoreCv(
  settings: LlmSettings,
  jobTitle: string,
  jobPrompt: string,
  cvText: string,
  criteria: JobCriteria,
): Promise<{ score: number; reasoning: string; criteria: CriteriaVerdict | null; education: EducationVerdict }> {
  const cv = cvText.length > MAX_CV_CHARS ? cvText.slice(0, MAX_CV_CHARS) + '\n[...CV truncated...]' : cvText;
  const data = await ollamaFetch(settings, '/api/chat', {
    model: settings.model,
    stream: false,
    format: VERDICT_SCHEMA,
    options: { temperature: 0.2 },
    messages: [
      { role: 'system', content: SCORING_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `JOB TITLE: ${jobTitle}\n\nJOB DESCRIPTION AND REQUIREMENTS:\n${jobPrompt}${criteriaPrompt(criteria)}${educationPrompt()}\n\nCANDIDATE CV:\n${cv}`,
      },
    ],
  }) as { message?: { content?: string } };

  const content = data.message?.content ?? '';
  try {
    const parsed = JSON.parse(content) as { score: number; reasoning: string } & RawCriteriaFields & RawEducationFields;
    if (typeof parsed.score !== 'number' || typeof parsed.reasoning !== 'string') throw new Error('missing fields');
    return {
      score: Math.max(0, Math.min(100, parsed.score)),
      reasoning: parsed.reasoning.trim(),
      criteria: evaluateCriteria(criteria, parsed),
      education: evaluateEducation(parsed),
    };
  } catch (err) {
    throw new AppError('AVZ-LLM-203', settings.baseUrl, `raw response: ${content.slice(0, 300)}`, err);
  }
}
