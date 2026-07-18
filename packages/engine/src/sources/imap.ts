import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AppError } from '../errors';
import type { ImapSettings } from '../types';
import { SUPPORTED_EXTENSIONS } from '../parsing/extract';

/** Contact details lifted from a message's From header — more reliable than CV scraping. */
export interface EmailContactHint {
  email: string | null;
  name: string | null;
}

export interface ImapFetchResult {
  /** Absolute paths of the attachments written to destDir. */
  files: string[];
  /** file path → sender contact from the From header. */
  hints: Map<string, EmailContactHint>;
  /** Message-ids of the applications imported this run (record these to dedup later). */
  newMessageIds: string[];
  skippedNoAttachment: number;
  alreadyImported: number;
}

function makeClient(imap: ImapSettings): ImapFlow {
  return new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });
}

function mapConnectError(err: unknown, imap: ImapSettings): AppError {
  const msg = err instanceof Error ? err.message : String(err);
  const code = /auth|credential|login|password|AUTHENTICATIONFAILED|invalid/i.test(msg) ? 'AVZ-SRC-412' : 'AVZ-SRC-411';
  return new AppError(code, `${imap.host}:${imap.port}`, msg, err);
}

/** "Test connections" for an email source: connect and open the mailbox. */
export async function testImapConnection(imap: ImapSettings): Promise<void> {
  const client = makeClient(imap);
  try {
    await client.connect();
  } catch (err) {
    throw mapConnectError(err, imap);
  }
  try {
    const lock = await client.getMailboxLock(imap.mailbox || 'INBOX');
    lock.release();
  } catch (err) {
    throw new AppError('AVZ-SRC-413', `${imap.host}/${imap.mailbox}`, err instanceof Error ? err.message : String(err), err);
  } finally {
    await client.logout();
  }
}

/**
 * Fetch application attachments from the mailbox within [dateFrom, dateTo] (inclusive,
 * ISO yyyy-mm-dd), skipping any message already imported. Each message is assumed to
 * carry a single CV; the first supported attachment is written to destDir. Returns the
 * saved files, per-file From-header contact hints, and the new message-ids.
 */
export async function fetchImapCvs(
  imap: ImapSettings,
  dateFrom: string,
  dateTo: string,
  alreadyImported: Set<string>,
  destDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImapFetchResult> {
  fs.mkdirSync(destDir, { recursive: true });
  const result: ImapFetchResult = {
    files: [], hints: new Map(), newMessageIds: [], skippedNoAttachment: 0, alreadyImported: 0,
  };

  const client = makeClient(imap);
  try {
    await client.connect();
  } catch (err) {
    throw mapConnectError(err, imap);
  }

  let lock: { release: () => void } | undefined;
  try {
    try {
      lock = await client.getMailboxLock(imap.mailbox || 'INBOX');
    } catch (err) {
      throw new AppError('AVZ-SRC-413', `${imap.host}/${imap.mailbox}`, err instanceof Error ? err.message : String(err), err);
    }

    // IMAP SINCE is inclusive; BEFORE is exclusive and date-only — add a day so dateTo is included.
    const since = new Date(`${dateFrom}T00:00:00`);
    const before = new Date(`${dateTo}T00:00:00`);
    before.setDate(before.getDate() + 1);

    const uids = (await client.search({ since, before }, { uid: true })) || [];
    let done = 0;
    for (const uid of uids) {
      onProgress?.(done, uids.length);
      done += 1;

      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      const source = msg && typeof msg !== 'boolean' ? (msg as { source?: Buffer }).source : undefined;
      if (!source) continue;

      const parsed = await simpleParser(source);
      const messageId = parsed.messageId || `uid:${imap.mailbox}:${uid}`;
      if (alreadyImported.has(messageId)) { result.alreadyImported += 1; continue; }

      const attachment = (parsed.attachments || []).find(
        a => SUPPORTED_EXTENSIONS.includes(path.extname(a.filename || '').toLowerCase()),
      );
      if (!attachment) { result.skippedNoAttachment += 1; continue; }

      const ext = path.extname(attachment.filename || '.pdf').toLowerCase();
      const rawName = (attachment.filename || 'cv').replace(/[^a-zA-Z0-9._-]/g, '_');
      const base = `${uid}-${rawName}`;
      const dest = path.join(destDir, base.toLowerCase().endsWith(ext) ? base : base + ext);
      fs.writeFileSync(dest, attachment.content);

      const from = parsed.from?.value?.[0];
      result.files.push(dest);
      result.hints.set(dest, { email: from?.address ?? null, name: from?.name?.trim() || null });
      result.newMessageIds.push(messageId);
    }
    onProgress?.(uids.length, uids.length);
  } finally {
    lock?.release();
    await client.logout();
  }

  if (result.files.length === 0) {
    throw new AppError(
      'AVZ-SRC-414',
      `${imap.host}/${imap.mailbox} ${dateFrom}..${dateTo}`,
      `${result.alreadyImported} already imported, ${result.skippedNoAttachment} without a CV attachment`,
    );
  }

  return result;
}
