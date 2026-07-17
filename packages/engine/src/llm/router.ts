/**
 * Provider-agnostic LLM surface. The rest of the app calls these; the profile's
 * `llm.provider` decides whether the work goes to a local/remote Ollama server
 * or to the Claude API (for recruiters who already have Anthropic API credits).
 */
import { asAppError } from '../errors';
import type { Database } from '../db/database';
import type { CriteriaVerdict, JobCriteria, LlmSettings, LlmVerdict, ScreeningProgress } from '../types';
import { mapLimit } from '../util/concurrency';
import { ollamaListModels, ollamaScoreCv, ollamaTestConnection } from './ollama';
import { anthropicListModels, anthropicScoreCv, anthropicTestConnection } from './anthropic';

export async function listModels(settings: LlmSettings): Promise<string[]> {
  return settings.provider === 'anthropic' ? anthropicListModels(settings) : ollamaListModels(settings);
}

export async function testLlmConnection(settings: LlmSettings): Promise<void> {
  return settings.provider === 'anthropic' ? anthropicTestConnection(settings) : ollamaTestConnection(settings);
}

export async function scoreCv(
  settings: LlmSettings,
  jobTitle: string,
  jobPrompt: string,
  cvText: string,
  criteria: JobCriteria,
): Promise<{ score: number; reasoning: string; criteria: CriteriaVerdict | null }> {
  return settings.provider === 'anthropic'
    ? anthropicScoreCv(settings, jobTitle, jobPrompt, cvText, criteria)
    : ollamaScoreCv(settings, jobTitle, jobPrompt, cvText, criteria);
}

/**
 * Score every given application against the job prompt. Individual failures
 * become per-candidate errors (AVZ-LLM-205 context), not a run abort.
 */
export async function runLlmAnalysis(
  jobId: number,
  applicationIds: number[],
  settings: LlmSettings,
  db: Database,
  concurrency: number,
  onProgress?: (p: ScreeningProgress) => void,
): Promise<{ verdicts: LlmVerdict[]; failures: { applicationId: number; code: string; message: string }[] }> {
  const job = db.getJob(jobId);
  const verdicts: LlmVerdict[] = [];
  const failures: { applicationId: number; code: string; message: string }[] = [];
  let done = 0;

  await mapLimit(applicationIds, Math.max(1, Math.min(concurrency, 2)), async (appId) => {
    try {
      const cvText = db.getCvText(appId);
      const { score, reasoning, criteria } = await scoreCv(settings, job.title, job.prompt, cvText, job.criteria);
      db.setVerdict(appId, score, reasoning, criteria);
      db.setApplicationStatus(appId, 'in_llm');
      verdicts.push({ applicationId: appId, score, reasoning });
    } catch (err) {
      const appErr = asAppError(err, 'AVZ-LLM-205', `application ${appId}`);
      failures.push({ applicationId: appId, code: appErr.code, message: appErr.message });
    } finally {
      done += 1;
      onProgress?.({ phase: 'analyzing', done, total: applicationIds.length });
    }
  });

  return { verdicts, failures };
}
