import { useEffect, useState } from 'react';
import type { ApplicationRow } from '@avanzare/engine';
import type { EmailTemplates } from '../api';

export interface EmailBatchPlan {
  kind: 'rejection' | 'acceptance';
  apps: ApplicationRow[];
}

interface Props {
  jobTitle: string;
  templates: EmailTemplates;
  batches: EmailBatchPlan[];
  onConfirm: (templates: EmailTemplates) => void;
  onCancel: () => void;
}

const GRACE_SECONDS = 30;

function render(tpl: string, name: string, jobTitle: string): string {
  return tpl.replace(/\{\{name\}\}/g, name).replace(/\{\{job_title\}\}/g, jobTitle);
}

/**
 * Preview & approve before any bulk send: shows rendered previews for the first
 * few recipients of each batch, lets the recruiter tweak subject/body for this
 * send only, and then arms a 30-second undo countdown before anything leaves.
 */
export default function EmailPreviewModal({ jobTitle, templates, batches, onConfirm, onCancel }: Props) {
  const [tpl, setTpl] = useState<EmailTemplates>({ ...templates });
  const [stage, setStage] = useState<'preview' | 'countdown'>('preview');
  const [left, setLeft] = useState(GRACE_SECONDS);

  useEffect(() => {
    if (stage !== 'countdown') return;
    if (left <= 0) { onConfirm(tpl); return; }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, left, onConfirm, tpl]);

  const set = (patch: Partial<EmailTemplates>) => setTpl(prev => ({ ...prev, ...patch }));
  const totalWithEmail = batches.reduce((n, b) => n + b.apps.filter(a => a.email).length, 0);
  const totalNoEmail = batches.reduce((n, b) => n + b.apps.filter(a => !a.email).length, 0);

  return (
    <div className="modal-overlay" onClick={stage === 'preview' ? onCancel : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Review before sending</h2>
        <p className="hint">
          {totalWithEmail} email(s) will be sent{totalNoEmail > 0 && <> — {totalNoEmail} recipient(s) have no email and will only be marked</>}.
          Edits below apply to <strong>this send only</strong>; change the defaults under Technical Settings.
        </p>

        {batches.filter(b => b.apps.length > 0).map(b => {
          const subjKey = b.kind === 'rejection' ? 'rejectionSubject' as const : 'acceptanceSubject' as const;
          const bodyKey = b.kind === 'rejection' ? 'rejectionBody' as const : 'acceptanceBody' as const;
          const previews = b.apps.filter(a => a.email).slice(0, 3);
          return (
            <div key={b.kind}>
              <h3>{b.kind === 'rejection' ? `Rejection (${b.apps.length})` : `Acceptance (${b.apps.length})`}</h3>
              <label className="field"><span>Subject</span>
                <input type="text" value={tpl[subjKey]} disabled={stage !== 'preview'}
                  onChange={e => set({ [subjKey]: e.target.value } as Partial<EmailTemplates>)} />
              </label>
              <label className="field" style={{ marginTop: 6 }}><span>Body</span>
                <textarea rows={5} value={tpl[bodyKey]} disabled={stage !== 'preview'}
                  onChange={e => set({ [bodyKey]: e.target.value } as Partial<EmailTemplates>)} />
              </label>
              {previews.map(a => (
                <div className="email-preview" key={a.id}>
                  <div className="sub">To: {a.name} &lt;{a.email}&gt;</div>
                  <div className="subj">{render(tpl[subjKey], a.name, jobTitle)}</div>
                  <pre>{render(tpl[bodyKey], a.name, jobTitle)}</pre>
                </div>
              ))}
              {b.apps.filter(a => a.email).length > previews.length && (
                <p className="hint">…and {b.apps.filter(a => a.email).length - previews.length} more with the same template.</p>
              )}
            </div>
          );
        })}

        {stage === 'preview' ? (
          <div className="btn-row">
            <button className="btn primary" onClick={() => { setLeft(GRACE_SECONDS); setStage('countdown'); }}>
              Approve &amp; send
            </button>
            <button className="btn" onClick={onCancel}>Cancel</button>
          </div>
        ) : (
          <div className="countdown">
            <span className="num">{left}</span>
            <span>Sending in {left}s — last chance to change your mind.</span>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => onConfirm(tpl)}>Send now</button>
            <button className="btn danger" onClick={() => { setStage('preview'); setLeft(GRACE_SECONDS); }}>Cancel send</button>
          </div>
        )}
      </div>
    </div>
  );
}
