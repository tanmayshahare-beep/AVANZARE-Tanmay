/**
 * Case-insensitive keyword matching with word boundaries where they make sense.
 * "java" must not match "javascript", but "c++" or ".NET" still need to match
 * even though \b misbehaves around symbols — so boundaries are only applied
 * next to alphanumeric ends of the keyword.
 */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const haystack = text.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    const needle = kw.trim().toLowerCase();
    if (!needle) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pre = /^[a-z0-9]/.test(needle) ? '(?<![a-z0-9])' : '';
    const post = /[a-z0-9]$/.test(needle) ? '(?![a-z0-9])' : '';
    if (new RegExp(`${pre}${escaped}${post}`, 'i').test(haystack)) matched.push(kw.trim());
  }
  return matched;
}

export function parseKeywordList(input: string): string[] {
  return [...new Set(input.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean))];
}
