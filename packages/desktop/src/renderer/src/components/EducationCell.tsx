import type { EducationVerdict } from '@avanzare/engine';

/**
 * Formal-education breakdown the LLM extracted: highest degree, university CGPA,
 * and 12th / 10th marks. Fields the CV didn't reveal are simply omitted; the
 * education_score itself is folded into the affinity score, so it isn't repeated here.
 */
export default function EducationCell({ verdict }: { verdict: EducationVerdict | null }) {
  if (!verdict) return <span className="muted">—</span>;

  const parts: string[] = [];
  if (verdict.highestDegree) parts.push(verdict.highestDegree);
  if (verdict.cgpa !== null) {
    parts.push(`CGPA ${verdict.cgpa}${verdict.cgpaScale !== null ? `/${verdict.cgpaScale}` : ''}`);
  }
  if (verdict.twelfthPercentage !== null) parts.push(`12th ${verdict.twelfthPercentage}%`);
  if (verdict.tenthPercentage !== null) parts.push(`10th ${verdict.tenthPercentage}%`);

  if (parts.length === 0) return <span className="muted">not stated</span>;
  return <span className="sub edu">{parts.join(' · ')}</span>;
}
