import { useEffect, useMemo, useState } from 'react';
import type { ScreeningProgress, ScreeningResult, SettingsProfile } from '@avanzare/engine';
import { avz, call } from '../api';
import Job, { type JobDef } from './Job';
import type { Toast } from '../App';

/** One queued screening task: a technical profile snapshot + a job definition, plus live run state. */
export interface BatchTask {
  id: string;
  /** Snapshot of the chosen technical profile, so editing/deleting the profile later can't change a queued run. */
  profile: SettingsProfile;
  def: JobDef;
  status: 'queued' | 'running' | 'done' | 'error';
  progress?: ScreeningProgress;
  result?: ScreeningResult;
  error?: { code: string; message: string };
}

interface Props {
  tasks: BatchTask[];
  running: boolean;
  maxConcurrent: number;
  onMaxConcurrent: (n: number) => void;
  onAdd: (profile: SettingsProfile, def: JobDef) => void;
  onUpdate: (id: string, profile: SettingsProfile, def: JobDef) => void;
  onRemove: (id: string) => void;
  onRunAll: () => void;
  onReview: (task: BatchTask) => void;
  onClearFinished: () => void;
  notify: (text: string, kind?: Toast['kind']) => void;
}

function sourceDesc(t: BatchTask): string {
  const p = t.profile;
  if (p.source.kind === 'email') {
    const box = `${p.source.imap?.host}/${p.source.imap?.mailbox || 'INBOX'}`;
    return `${box} · ${t.def.emailDateFrom}…${t.def.emailDateTo}`;
  }
  return p.source.path;
}

function StatusBadge({ t }: { t: BatchTask }) {
  if (t.status === 'done') return <span className="badge ok">done</span>;
  if (t.status === 'error') return <span className="badge danger">error</span>;
  if (t.status === 'running') return <span className="badge">running</span>;
  return <span className="badge">queued</span>;
}

function TaskProgress({ p }: { p?: ScreeningProgress }) {
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const label = !p ? 'Starting…'
    : p.phase === 'importing' ? `Fetching applications… ${p.done}/${p.total}`
    : p.phase === 'scanning' ? 'Scanning source…'
    : `${p.done}/${p.total}${p.currentFile ? ` — ${p.currentFile}` : ''}`;
  return (
    <>
      <div className="progress-outer" style={{ marginTop: 8 }}>
        <div className="progress-inner" style={{ width: `${pct}%` }} />
      </div>
      <p className="hint" style={{ marginTop: 4 }}>{label}</p>
    </>
  );
}

export default function Batch({
  tasks, running, maxConcurrent, onMaxConcurrent,
  onAdd, onUpdate, onRemove, onRunAll, onReview, onClearFinished, notify,
}: Props) {
  const [profiles, setProfiles] = useState<SettingsProfile[]>([]);
  // editing === null: no editor open. { id: null }: adding new. { id }: editing that task.
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [editProfileName, setEditProfileName] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const list = await call(avz.profiles.list(), notify);
      if (list) setProfiles(list.filter(p => p.name));
    })();
  }, [notify]);

  const editTask = editing?.id ? tasks.find(t => t.id === editing.id) ?? null : null;
  const editProfile = useMemo(
    () => profiles.find(p => p.name === editProfileName) ?? null,
    [profiles, editProfileName],
  );

  const openAdd = () => {
    if (!profiles.length) { notify('Save at least one technical profile (Technical Settings) before batching.', 'info'); return; }
    setEditProfileName(profiles[0].name);
    setEditing({ id: null });
  };
  const openEdit = (t: BatchTask) => {
    setEditProfileName(t.profile.name || (profiles[0]?.name ?? ''));
    setEditing({ id: t.id });
  };
  const closeEditor = () => setEditing(null);

  const saveTask = (def: JobDef) => {
    if (!editProfile) { notify('Pick a technical profile for this task.', 'error'); return; }
    if (editing?.id) onUpdate(editing.id, editProfile, def);
    else onAdd(editProfile, def);
    closeEditor();
  };

  const queuedCount = tasks.filter(t => t.status === 'queued' || t.status === 'error').length;
  const finishedCount = tasks.filter(t => t.status === 'done' || t.status === 'error').length;

  const profilePicker = (
    <label className="field" style={{ marginBottom: 12 }}>
      <span>Technical profile — CV source, LLM endpoint, SMTP and runtime for this task</span>
      <select value={editProfileName} onChange={e => setEditProfileName(e.target.value)}>
        {profiles.map(p => (
          <option key={p.name} value={p.name}>
            {p.name} — {p.source.kind === 'email' ? `email · ${p.source.imap?.host}` : `folder · ${p.source.path || '(unset)'}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <div className="panel">
        <h2>Batch screening (multitasking)</h2>
        <p className="hint">
          Queue several screening tasks — each with its own technical profile and keywords — and run them
          <strong> concurrently</strong>. Each task parses and keyword-screens its CVs in the background; when it
          finishes you <strong>Review</strong> it to rescue near-misses, run the LLM analysis, and send emails,
          exactly as in a single run. Emails are never sent automatically.
        </p>

        <div className="btn-row" style={{ alignItems: 'center' }}>
          <button className="btn" onClick={openAdd} disabled={running || editing !== null}>＋ Add task</button>
          <span className="spacer" />
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 0 }}>
            <span style={{ whiteSpace: 'nowrap' }}>Max concurrent</span>
            <input type="number" min={1} max={16} value={maxConcurrent} disabled={running}
              style={{ width: 70 }}
              onChange={e => onMaxConcurrent(Math.max(1, Math.min(16, Number(e.target.value) || 1)))} />
          </label>
          <button className="btn primary" onClick={onRunAll} disabled={running || queuedCount === 0}>
            {running ? 'Running…' : `Run all (${queuedCount})`}
          </button>
          {finishedCount > 0 && !running && (
            <button className="btn" onClick={onClearFinished}>Clear finished</button>
          )}
        </div>
        {running && (
          <p className="hint" style={{ marginTop: 8 }}>
            Tasks are running concurrently (up to {maxConcurrent} at once). You can switch tabs — they keep going.
          </p>
        )}
      </div>

      {editing !== null && (
        <Job
          key={editing.id ?? 'new'}
          profile={editProfile ?? profiles[0]}
          initial={editTask?.def ?? null}
          heading={editing.id ? 'Edit task' : 'Add task to batch'}
          submitLabel={editing.id ? 'Save changes' : 'Add task'}
          onStart={saveTask}
        >
          {profilePicker}
        </Job>
      )}

      {tasks.length === 0 && editing === null && (
        <div className="panel"><p className="muted">No tasks queued yet. Click “＋ Add task” to build your first hiring task.</p></div>
      )}

      {tasks.map(t => {
        const r = t.result;
        return (
          <div className="panel batch-task" key={t.id}>
            <div className="btn-row" style={{ alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 16 }}>{t.def.title || '(untitled)'}</strong>
              <StatusBadge t={t} />
              <span className="profile-chip">{t.profile.name || '(unsaved)'}</span>
              <span className="spacer" />
              {t.status === 'done' && <button className="btn primary" onClick={() => onReview(t)}>Review →</button>}
              {(t.status === 'queued' || t.status === 'error') && !running && (
                <>
                  <button className="btn" onClick={() => openEdit(t)} disabled={editing !== null}>Edit</button>
                  <button className="btn" onClick={() => onRemove(t.id)} disabled={editing !== null}>Remove</button>
                </>
              )}
            </div>
            <p className="hint" style={{ margin: '2px 0' }}>
              {sourceDesc(t)} · {t.def.mandatory.length} mandatory / {t.def.optional.length} optional keyword(s)
            </p>

            {t.status === 'running' && <TaskProgress p={t.progress} />}

            {t.status === 'done' && r && (
              <p className="hint" style={{ marginTop: 4 }}>
                <span className="badge ok">{r.acceptedMandatory.length + r.acceptedOptional.length} accepted</span>{' '}
                <span className="badge">{r.rejected.length} rejected</span>{' '}
                {r.failures.length > 0 && <span className="badge danger">{r.failures.length} unparseable</span>}
                {r.targetAcceptances !== null && <> · target {r.targetAcceptances}</>}
              </p>
            )}

            {t.status === 'error' && t.error && (
              <p className="hint" style={{ marginTop: 4, color: 'var(--danger)' }}>
                {t.error.code}: {t.error.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
