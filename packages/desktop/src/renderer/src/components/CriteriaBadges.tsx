import type { CriteriaVerdict } from '@avanzare/engine';

/**
 * ✓/✗ verdicts for the job's requirement tags (certifications, experience
 * range, publications). Categories the recruiter didn't set are simply absent.
 */
export default function CriteriaBadges({ verdict }: { verdict: CriteriaVerdict | null }) {
  if (!verdict) return <span className="muted">—</span>;
  const badge = (ok: boolean, label: string) => (
    <span className={`badge ${ok ? 'ok' : 'danger'}`} style={{ marginRight: 4 }}>
      {label} {ok ? '✓' : '✗'}
    </span>
  );
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {verdict.certificationsMet !== null && badge(verdict.certificationsMet, 'certs')}
      {verdict.experienceInRange !== null && badge(
        verdict.experienceInRange,
        verdict.experienceYears !== null ? `${verdict.experienceYears}y exp` : 'exp',
      )}
      {verdict.publicationsMatch !== null && badge(verdict.publicationsMatch, 'pubs')}
    </span>
  );
}
