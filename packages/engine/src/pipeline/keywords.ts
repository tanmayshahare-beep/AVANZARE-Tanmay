import type { KeywordSynonym } from '../types';

/**
 * Does one term appear in the (already lower-cased) haystack? Word boundaries are
 * applied only next to alphanumeric ends of the term, so "java" won't match
 * "javascript" but "c++" and ".NET" still match despite \b misbehaving on symbols.
 */
function termMatches(haystack: string, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pre = /^[a-z0-9]/.test(needle) ? '(?<![a-z0-9])' : '';
  const post = /[a-z0-9]$/.test(needle) ? '(?![a-z0-9])' : '';
  return new RegExp(`${pre}${escaped}${post}`, 'i').test(haystack);
}

/** Map of canonical-keyword (lower-cased) → its alias terms. */
export function buildSynonymMap(groups: KeywordSynonym[] | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const g of groups ?? []) {
    const canon = g.canonical.trim().toLowerCase();
    if (!canon) continue;
    const aliases = g.aliases.map(a => a.trim()).filter(Boolean);
    map.set(canon, [...(map.get(canon) ?? []), ...aliases]);
  }
  return map;
}

/**
 * Case-insensitive keyword matching. A keyword counts as matched when the keyword
 * itself OR any of its recruiter-defined synonyms appears in the text; either way
 * the returned list holds the *canonical* keyword, so downstream scoring, tiers
 * and dashboards are unaffected by which alias actually hit.
 */
export function matchKeywords(text: string, keywords: string[], synonyms?: Map<string, string[]>): string[] {
  const haystack = text.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    const key = kw.trim();
    if (!key) continue;
    const terms = [key, ...(synonyms?.get(key.toLowerCase()) ?? [])];
    if (terms.some(t => termMatches(haystack, t))) matched.push(key);
  }
  return matched;
}

export function parseKeywordList(input: string): string[] {
  return [...new Set(input.split(/[,\n;]+/).map(s => s.trim()).filter(Boolean))];
}
