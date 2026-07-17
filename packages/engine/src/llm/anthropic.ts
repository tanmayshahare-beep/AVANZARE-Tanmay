import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../errors';
import type { CriteriaVerdict, JobCriteria, LlmSettings } from '../types';
import { CRITERIA_SCHEMA_PROPERTIES, criteriaPrompt, evaluateCriteria, type RawCriteriaFields } from './criteria';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

function makeClient(settings: LlmSettings): Anthropic {
  return new Anthropic({
    apiKey: settings.apiKey,
    timeout: settings.timeoutMs, // TypeScript SDK takes milliseconds
    maxRetries: 2,
  });
}

/** Map the SDK's typed errors onto AVZ codes, most specific first. */
function mapError(err: unknown, location: string): AppError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AppError('AVZ-LLM-206', location, err.message, err);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AppError('AVZ-LLM-202', location, err.message, err);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError('AVZ-LLM-207', location, err.message, err);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError('AVZ-LLM-204', location, err.message, err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AppError('AVZ-LLM-201', location, err.message, err);
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError('AVZ-LLM-205', location, `HTTP ${err.status}: ${err.message}`, err);
  }
  return new AppError('AVZ-LLM-201', location, err instanceof Error ? err.message : String(err), err);
}

export async function anthropicListModels(settings: LlmSettings): Promise<string[]> {
  try {
    const ids: string[] = [];
    for await (const m of makeClient(settings).models.list()) ids.push(m.id);
    return ids;
  } catch (err) {
    throw mapError(err, 'api.anthropic.com/v1/models');
  }
}

export async function anthropicTestConnection(settings: LlmSettings): Promise<void> {
  if (!settings.apiKey.trim()) throw new AppError('AVZ-LLM-206', 'anthropic', 'no API key configured');
  const model = settings.model || DEFAULT_ANTHROPIC_MODEL;
  try {
    await makeClient(settings).models.retrieve(model);
  } catch (err) {
    throw mapError(err, `api.anthropic.com (model "${model}")`);
  }
}

// Structured-outputs schema. Numerical constraints (minimum/maximum) are not
// supported by the API's schema subset — the 0-10 range is clamped client-side.
const VERDICT_SCHEMA = {
  type: 'object' as const,
  properties: {
    score: { type: 'number' as const },
    reasoning: { type: 'string' as const },
    ...CRITERIA_SCHEMA_PROPERTIES,
  },
  required: ['score', 'reasoning', 'certifications_met', 'experience_years', 'publications_match'],
  additionalProperties: false as const,
};

const SYSTEM_PROMPT =
  'You are an experienced technical recruiter. Evaluate how well the candidate\'s CV fits the job description. ' +
  'Respond with JSON: "score" (0-10, one decimal allowed; 10 = perfect fit) and "reasoning" ' +
  '(one concise paragraph naming the concrete strengths and gaps that drove the score).';

const MAX_CV_CHARS = 60_000; // Claude context windows dwarf local models'; still bound pathological inputs

export async function anthropicScoreCv(
  settings: LlmSettings,
  jobTitle: string,
  jobPrompt: string,
  cvText: string,
  criteria: JobCriteria,
): Promise<{ score: number; reasoning: string; criteria: CriteriaVerdict | null }> {
  const client = makeClient(settings);
  const model = settings.model || DEFAULT_ANTHROPIC_MODEL;
  const cv = cvText.length > MAX_CV_CHARS ? cvText.slice(0, MAX_CV_CHARS) + '\n[...CV truncated...]' : cvText;
  const userContent = `JOB TITLE: ${jobTitle}\n\nJOB DESCRIPTION AND REQUIREMENTS:\n${jobPrompt}${criteriaPrompt(criteria)}\n\nCANDIDATE CV:\n${cv}`;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 2048, // deliberately short output: one JSON object
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    // Some older models don't support structured outputs — fall back to prompting for JSON.
    if (err instanceof Anthropic.BadRequestError && /output_config|output_format/i.test(err.message)) {
      try {
        response = await client.messages.create({
          model,
          max_tokens: 2048,
          system: SYSTEM_PROMPT + ' Respond with ONLY the JSON object, no other text.',
          messages: [{ role: 'user', content: userContent }],
        });
      } catch (err2) {
        throw mapError(err2, `api.anthropic.com (model "${model}")`);
      }
    } else {
      throw mapError(err, `api.anthropic.com (model "${model}")`);
    }
  }

  if (response.stop_reason === 'refusal') {
    throw new AppError('AVZ-LLM-205', model, 'the model declined to evaluate this CV');
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
  try {
    // Structured outputs return pure JSON; the fallback path may wrap it in prose.
    const jsonText = text.trim().startsWith('{') ? text : (text.match(/\{[\s\S]*\}/)?.[0] ?? text);
    const parsed = JSON.parse(jsonText) as { score: number; reasoning: string } & RawCriteriaFields;
    if (typeof parsed.score !== 'number' || typeof parsed.reasoning !== 'string') throw new Error('missing fields');
    return {
      score: Math.max(0, Math.min(10, parsed.score)),
      reasoning: parsed.reasoning.trim(),
      criteria: evaluateCriteria(criteria, parsed),
    };
  } catch (err) {
    throw new AppError('AVZ-LLM-203', model, `raw response: ${text.slice(0, 300)}`, err);
  }
}
