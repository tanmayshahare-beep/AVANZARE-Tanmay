import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';
import type { Database } from '../db/database';
import type { ParseFailure, ScreeningInput, ScreeningProgress, ScreeningResult, Tier } from '../types';
import { extractText, SUPPORTED_EXTENSIONS } from '../parsing/extract';
import { extractContact } from '../parsing/contact';
import { matchKeywords } from './keywords';
import { mapLimit } from '../util/concurrency';

/** Recursively collect CV files under the source folder. */
export function scanSource(sourcePath: string): string[] {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    throw new AppError('AVZ-SRC-401', sourcePath);
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  };
  walk(sourcePath);
  if (!files.length) throw new AppError('AVZ-SRC-402', sourcePath);
  return files;
}

/**
 * The mandatory/optional keyword screening stage: scan → extract text+contact →
 * bucket into rejected / mandatory-only / mandatory+optional. Everything is
 * persisted; the recruiter's decisions happen afterwards in the UI.
 */
export async function runScreening(
  input: ScreeningInput,
  db: Database,
  onProgress?: (p: ScreeningProgress) => void,
): Promise<ScreeningResult> {
  onProgress?.({ phase: 'scanning', done: 0, total: 0 });
  const files = scanSource(input.sourcePath);
  const jobId = db.createJob(input.jobTitle, input.prompt, input.mandatoryKeywords, input.optionalKeywords);

  const failures: ParseFailure[] = [];
  let done = 0;

  await mapLimit(files, input.concurrency, async (file) => {
    try {
      const text = await extractText(file);
      const contact = extractContact(text, file);
      const matchedMandatory = matchKeywords(text, input.mandatoryKeywords);
      const matchedOptional = matchKeywords(text, input.optionalKeywords);

      const allMandatory = matchedMandatory.length === input.mandatoryKeywords.length;
      const tier: Tier = !allMandatory ? 'rejected' : matchedOptional.length > 0 ? 'optional' : 'mandatory';

      const candidateId = db.upsertCandidate(contact.name, contact.email, contact.phone, file);
      db.insertApplication(jobId, candidateId, file, text, tier, matchedMandatory, matchedOptional);
    } catch (err) {
      const appErr = err instanceof AppError ? err : new AppError('AVZ-APP-901', file, String(err));
      failures.push({ file, code: appErr.code, message: appErr.message });
    } finally {
      done += 1;
      onProgress?.({ phase: 'parsing', done, total: files.length, currentFile: path.basename(file) });
    }
  });

  return {
    jobId,
    rejected: db.listApplications(jobId, ['rejected']),
    acceptedMandatory: db.listApplications(jobId, ['mandatory']),
    acceptedOptional: db.listApplications(jobId, ['optional']),
    failures,
  };
}
