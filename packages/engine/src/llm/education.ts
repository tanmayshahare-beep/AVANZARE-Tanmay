import type { EducationVerdict } from '../types';

/**
 * Raw formal-education fields the model reports; mapped to an EducationVerdict
 * client-side. Absent values come back as the sentinel -1 (numbers) or "" (degree)
 * rather than null, because the provider json-schema subset that rejects min/max
 * also can't be relied on for nullable type unions — so we keep every field a
 * plain required type and normalize the sentinels here.
 */
export interface RawEducationFields {
  tenth_percentage?: number;
  twelfth_percentage?: number;
  cgpa?: number;
  cgpa_scale?: number;
  highest_degree?: string;
  education_score?: number;
}

/** JSON-schema properties for the education fields, shared by both providers. */
export const EDUCATION_SCHEMA_PROPERTIES = {
  tenth_percentage: { type: 'number' as const },
  twelfth_percentage: { type: 'number' as const },
  cgpa: { type: 'number' as const },
  cgpa_scale: { type: 'number' as const },
  highest_degree: { type: 'string' as const },
  education_score: { type: 'number' as const },
};

/** Instruction block appended to every scoring prompt — education is always assessed. */
export function educationPrompt(): string {
  return (
    '\n\nFORMAL EDUCATION (extract and report every field in the JSON; use -1 for any number ' +
    'and "" for the degree when the CV does not state it — never guess):\n' +
    '- "tenth_percentage": 10th-grade / secondary-school marks as a percentage 0-100.\n' +
    '- "twelfth_percentage": 12th-grade / higher-secondary marks as a percentage 0-100. ' +
    'Convert a GPA-style board result to an approximate percentage if that is all the CV gives.\n' +
    '- "cgpa": the university CGPA/GPA as stated, and "cgpa_scale" the scale it is out of (e.g. 8.7 with scale 10, or 3.6 with scale 4).\n' +
    '- "highest_degree": the highest qualification attained or in progress (e.g. "B.Tech", "M.Sc", "MBA", "PhD").\n' +
    '- "education_score": your 0-100 rating of the candidate\'s formal-education strength. Reward higher and more ' +
    'advanced qualifications and consistently strong academics (10th, 12th, CGPA); a stronger, more formal education ' +
    'earns a higher number. This is factored into the overall score.'
  );
}

// Absent values arrive as -1 / "" sentinels (see RawEducationFields).
const clampPct = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.max(0, Math.min(100, v)) : null;

const posNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** Turn the model's raw education fields into a normalized verdict. */
export function evaluateEducation(raw: RawEducationFields): EducationVerdict {
  const degree = typeof raw.highest_degree === 'string' && raw.highest_degree.trim()
    ? raw.highest_degree.trim()
    : null;
  return {
    tenthPercentage: clampPct(raw.tenth_percentage),
    twelfthPercentage: clampPct(raw.twelfth_percentage),
    cgpa: posNum(raw.cgpa),
    cgpaScale: posNum(raw.cgpa_scale),
    highestDegree: degree,
    educationScore: clampPct(raw.education_score),
  };
}
