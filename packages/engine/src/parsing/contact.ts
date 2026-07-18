import path from 'node:path';

export interface ContactInfo {
  name: string;
  email: string | null;
  phone: string | null;
}

/** Trusted contact details from outside the CV (e.g. an email's From header). */
export interface ContactHint {
  email?: string | null;
  name?: string | null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// 8+ digits allowing separators/parentheses, optional +country code.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{6,14}\d/;

/**
 * Heuristic contact extraction. CVs are unstructured, so:
 * - email: first email-looking token (most reliable signal)
 * - phone: first phone-looking run of digits that isn't a date/zip (8-16 digits)
 * - name: first short line near the top that isn't contact info or a heading;
 *   falls back to the file name.
 *
 * When a `hint` is supplied (e.g. an application email's From header) its email
 * and name take precedence over the heuristics — they're a far more reliable
 * signal than scraping the CV body.
 */
export function extractContact(text: string, filePath: string, hint?: ContactHint): ContactInfo {
  const hintEmail = hint?.email?.trim() || null;
  const hintName = hint?.name?.trim() || null;
  const email = hintEmail ?? text.match(EMAIL_RE)?.[0] ?? null;

  let phone: string | null = null;
  const phoneMatch = text.match(PHONE_RE);
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) phone = phoneMatch[0].trim();
  }

  const headingWords = /curriculum|resume|cv\b|profile|summary|contact|address|objective/i;
  let name: string | null = null;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 15);
  for (const line of lines) {
    if (EMAIL_RE.test(line) && line.length < 60) continue;
    if (headingWords.test(line)) continue;
    if (/\d{4,}/.test(line)) continue; // phone numbers, dates, zips
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && line.length <= 50 && /^[\p{L}]/u.test(line)) {
      name = line.replace(/[|,;].*$/, '').trim();
      break;
    }
  }
  if (!name) {
    name = path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, ' ').trim();
  }
  // A From-header display name beats every heuristic when we have one.
  return { name: hintName ?? name, email, phone };
}
