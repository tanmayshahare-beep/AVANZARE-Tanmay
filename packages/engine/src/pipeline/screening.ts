import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';
import type { Database } from '../db/database';
import type { ParseFailure, ScreeningInput, ScreeningProgress, ScreeningResult, Tier } from '../types';
import { extractText, SUPPORTED_EXTENSIONS } from '../parsing/extract';
import { extractContact, type ContactHint } from '../parsing/contact';
import { buildSynonymMap, matchKeywords } from './keywords';
import { fetchImapCvs } from '../sources/imap';
import { mapLimit } from '../util/concurrency';

/** Extra options the host supplies to runScreening (e.g. where to store email attachments). */
export interface ScreeningOptions {
  /** Durable folder for CVs downloaded from an email source (they become each cv_path). */
  emailDownloadDir?: string;
}

/**
 * Turn the configured source into a concrete list of CV files. Local folders are
 * scanned directly; an email source is fetched into a durable download folder,
 * returning per-file From-header contact hints and the new message-ids to record.
 */
async function resolveSource(
  input: ScreeningInput,
  db: Database,
  opts: ScreeningOptions | undefined,
  onProgress?: (p: ScreeningProgress) => void,
): Promise<{ files: string[]; hints: Map<string, ContactHint>; newMessageIds: string[]; mailbox: string }> {
  if (input.emailImap) {
    if (!opts?.emailDownloadDir) {
      throw new AppError('AVZ-APP-901', 'email source', 'no download directory was provided for the email source');
    }
    onProgress?.({ phase: 'importing', done: 0, total: 0 });
    const already = db.importedMessageIds();
    const res = await fetchImapCvs(
      input.emailImap,
      input.emailDateFrom ?? '',
      input.emailDateTo ?? '',
      already,
      opts.emailDownloadDir,
      (done, total) => onProgress?.({ phase: 'importing', done, total }),
    );
    return { files: res.files, hints: res.hints, newMessageIds: res.newMessageIds, mailbox: input.emailImap.mailbox };
  }

  onProgress?.({ phase: 'scanning', done: 0, total: 0 });
  return { files: scanSource(input.sourcePath), hints: new Map(), newMessageIds: [], mailbox: '' };
}

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
  opts?: ScreeningOptions,
): Promise<ScreeningResult> {
  const { files, hints, newMessageIds, mailbox } = await resolveSource(input, db, opts, onProgress);

  const failures: ParseFailure[] = [];
  let done = 0;

  // Clamp recruiter-supplied importances to the documented 1-5 range.
  const mandatory = input.mandatoryKeywords.map(k => ({
    keyword: k.keyword,
    importance: Math.max(1, Math.min(5, Math.round(k.importance) || 3)),
  }));
  const targetAcceptances = input.targetAcceptances !== null && input.targetAcceptances > 0
    ? Math.floor(input.targetAcceptances)
    : null;
  const synonymMap = buildSynonymMap(input.keywordSynonyms);
  const jobId = db.createJob(
    input.jobTitle, input.prompt, mandatory, input.optionalKeywords,
    input.keywordSynonyms, input.criteria, targetAcceptances,
  );

  await mapLimit(files, input.concurrency, async (file) => {
    try {
      const text = await extractText(file, input.ocr);
      const contact = extractContact(text, file, hints.get(file));
      const matchedMandatory = matchKeywords(text, mandatory.map(k => k.keyword), synonymMap);
      const matchedOptional = matchKeywords(text, input.optionalKeywords, synonymMap);

      const allMandatory = matchedMandatory.length === mandatory.length;
      const tier: Tier = !allMandatory ? 'rejected' : matchedOptional.length > 0 ? 'optional' : 'mandatory';

      // Weighted keyword score /5: a matched keyword earns its importance as
      // marks, a missing one earns 0; the score is the average across keywords.
      const keywordScore = mandatory.length
        ? mandatory.reduce((sum, k) => sum + (matchedMandatory.includes(k.keyword) ? k.importance : 0), 0) / mandatory.length
        : 0;

      // Hash of the exact CV bytes screened — the audit trail can prove which
      // version of a resume every decision and email was based on.
      const cvHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const candidateId = db.upsertCandidate(contact.name, contact.email, contact.phone, file);
      db.insertApplication(jobId, candidateId, file, text, cvHash, tier, matchedMandatory, matchedOptional, keywordScore);
    } catch (err) {
      const appErr = err instanceof AppError ? err : new AppError('AVZ-APP-901', file, String(err));
      failures.push({ file, code: appErr.code, message: appErr.message });
    } finally {
      done += 1;
      onProgress?.({ phase: 'parsing', done, total: files.length, currentFile: path.basename(file) });
    }
  });

  // Remember which emails we imported so an overlapping date range never re-imports them.
  if (newMessageIds.length) db.recordImportedMessages(newMessageIds, mailbox);

  const sourceDesc = input.emailImap
    ? `mailbox ${input.emailImap.host}/${mailbox} (${input.emailDateFrom}..${input.emailDateTo})`
    : input.sourcePath;
  db.audit('screening_run',
    `job "${input.jobTitle}" (id ${jobId}): ${files.length} file(s) from ${sourceDesc}, ${failures.length} unparseable`);

  return {
    jobId,
    rejected: db.listApplications(jobId, ['rejected']),
    acceptedMandatory: db.listApplications(jobId, ['mandatory']),
    acceptedOptional: db.listApplications(jobId, ['optional']),
    failures,
    targetAcceptances,
  };
}
