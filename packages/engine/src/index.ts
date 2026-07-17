export * from './errors';
export * from './types';
export { ProfileStore, defaultProfile, validateProfile, DEFAULT_TEMPLATES } from './config/profiles';
export { Database, type CandidateRecord, type CandidateSearchHit } from './db/database';
export { extractText, SUPPORTED_EXTENSIONS } from './parsing/extract';
export { extractContact, type ContactInfo } from './parsing/contact';
export { matchKeywords, parseKeywordList, buildSynonymMap } from './pipeline/keywords';
export { runScreening, scanSource } from './pipeline/screening';
export { listModels, testLlmConnection, scoreCv, runLlmAnalysis } from './llm/router';
export { DEFAULT_ANTHROPIC_MODEL } from './llm/anthropic';
export { evaluateCriteria, criteriaPrompt } from './llm/criteria';
export { sendDecisionEmails, testSmtpConnection, type EmailKind } from './mail/mailer';
export { exportApplications, exportCandidates, exportAudit } from './export/xlsx';
export { Logger, defaultLogger } from './util/logger';

import { AppError } from './errors';
import { scanSource } from './pipeline/screening';
import { testLlmConnection } from './llm/router';
import { testSmtpConnection } from './mail/mailer';
import type { ConnectionTestResult, SettingsProfile } from './types';

/** "Test connections" in the setup window: checks source, LLM, and SMTP independently. */
export async function testConnections(profile: SettingsProfile): Promise<ConnectionTestResult[]> {
  const results: ConnectionTestResult[] = [];

  try {
    if (profile.source.kind === 'cloud') throw new AppError('AVZ-SRC-403', profile.source.provider ?? 'cloud');
    const files = scanSource(profile.source.path);
    results.push({ target: 'source', ok: true, message: `${files.length} CV file(s) found` });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError('AVZ-SRC-401', profile.source.path, String(err));
    results.push({ target: 'source', ok: false, message: e.message, errorCode: e.code });
  }

  try {
    await testLlmConnection(profile.llm);
    const providerName = profile.llm.provider === 'anthropic' ? 'Claude API' : 'Ollama';
    results.push({ target: 'llm', ok: true, message: `${providerName} reachable, model "${profile.llm.model}" available` });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError('AVZ-LLM-201', profile.llm.baseUrl, String(err));
    results.push({ target: 'llm', ok: false, message: e.message, errorCode: e.code });
  }

  try {
    await testSmtpConnection(profile.smtp);
    results.push({ target: 'smtp', ok: true, message: `SMTP connection to ${profile.smtp.host}:${profile.smtp.port} OK` });
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError('AVZ-MAIL-301', profile.smtp.host, String(err));
    results.push({ target: 'smtp', ok: false, message: e.message, errorCode: e.code });
  }

  return results;
}
