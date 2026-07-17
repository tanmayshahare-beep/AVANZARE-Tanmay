import { useEffect, useState } from 'react';
import { avz, call } from '../api';

export interface CvDrawerTarget { applicationId: number; name: string; cvPath: string }

interface Props {
  target: CvDrawerTarget | null;
  onClose: () => void;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

/**
 * In-app CV previewer: side panel with the parsed text, so recruiters can review
 * a resume and manage checkboxes without switching windows. The original file is
 * one click away for layout-sensitive review.
 */
export default function CvDrawer({ target, onClose, notify }: Props) {
  const [text, setText] = useState<string>('');

  useEffect(() => {
    if (!target) return;
    setText('Loading…');
    void (async () => {
      const res = await call(avz.cvText(target.applicationId), notify);
      setText(res || '(no parsed text stored for this application)');
    })();
  }, [target, notify]);

  if (!target) return null;

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h3>{target.name}</h3>
        <button className="btn small" onClick={() => void call(avz.openFile(target.cvPath), notify)}>
          Open original {target.cvPath.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Word'}
        </button>
        <button className="btn small" onClick={onClose}>✕</button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}
