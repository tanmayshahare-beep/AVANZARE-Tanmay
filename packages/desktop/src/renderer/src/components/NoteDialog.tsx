import { useState } from 'react';

interface Props {
  count: number;
  onSave: (note: string) => void;
  onCancel: () => void;
}

/** Bulk internal note applied to every selected candidate. */
export default function NoteDialog({ count, onSave, onCancel }: Props) {
  const [note, setNote] = useState('');
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add note to {count} candidate{count === 1 ? '' : 's'}</h2>
        <p className="hint">
          Stored on each candidate's record (visible in every future screening and in exports),
          e.g. "Passed mandatory but lacked leadership experience — keep for junior roles."
        </p>
        <textarea rows={4} autoFocus value={note} onChange={e => setNote(e.target.value)}
          placeholder="Internal note…" />
        <div className="btn-row">
          <button className="btn primary" disabled={!note.trim()} onClick={() => onSave(note)}>Save note</button>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
