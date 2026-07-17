import { criteriaActive, type CriteriaVerdict, type JobCriteria } from '../types';

/** Raw fields the model reports; mapped to a CriteriaVerdict client-side. */
export interface RawCriteriaFields {
  certifications_met?: boolean;
  experience_years?: number;
  publications_match?: boolean;
}

/** JSON-schema properties for the criteria fields, shared by both providers. */
export const CRITERIA_SCHEMA_PROPERTIES = {
  certifications_met: { type: 'boolean' as const },
  experience_years: { type: 'number' as const },
  publications_match: { type: 'boolean' as const },
};

/** Requirement text appended to the user prompt when any tag is set. */
export function criteriaPrompt(c: JobCriteria): string {
  if (!criteriaActive(c)) return '';
  const lines: string[] = ['\nSTRUCTURED REQUIREMENTS (assess each and report it in the JSON):'];
  if (c.certifications.length) {
    lines.push(`- Certifications (ALL required): ${c.certifications.join(', ')}. ` +
      'Set "certifications_met" to true only if the CV shows every one of them.');
  }
  if (c.experienceMinYears !== null || c.experienceMaxYears !== null) {
    const range =
      c.experienceMinYears !== null && c.experienceMaxYears !== null
        ? `between ${c.experienceMinYears} and ${c.experienceMaxYears} years`
        : c.experienceMinYears !== null
          ? `at least ${c.experienceMinYears} years`
          : `at most ${c.experienceMaxYears} years`;
    lines.push(`- Relevant professional experience: ${range}. ` +
      'Set "experience_years" to your best estimate of the candidate\'s total relevant experience in years (0 if not determinable).');
  }
  if (c.publicationsField.trim()) {
    lines.push(`- Research publications in: ${c.publicationsField.trim()}. ` +
      'Set "publications_match" to true only if the CV shows research publications in that field.');
  }
  lines.push('Weigh these requirements in the overall score.');
  return '\n' + lines.join('\n');
}

/** Turn the model's raw fields into per-requirement verdicts; null per unrequested category. */
export function evaluateCriteria(c: JobCriteria, raw: RawCriteriaFields): CriteriaVerdict | null {
  if (!criteriaActive(c)) return null;
  const wantsExperience = c.experienceMinYears !== null || c.experienceMaxYears !== null;
  const years = typeof raw.experience_years === 'number' && raw.experience_years >= 0 ? raw.experience_years : null;
  return {
    certificationsMet: c.certifications.length ? raw.certifications_met === true : null,
    experienceYears: wantsExperience ? years : null,
    experienceInRange: wantsExperience
      ? (years ?? 0) >= (c.experienceMinYears ?? 0) &&
        (c.experienceMaxYears === null || (years ?? 0) <= c.experienceMaxYears)
      : null,
    publicationsMatch: c.publicationsField.trim() ? raw.publications_match === true : null,
  };
}
