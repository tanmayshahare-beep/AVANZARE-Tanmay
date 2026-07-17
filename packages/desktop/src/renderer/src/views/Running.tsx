import { useEffect, useState } from 'react';
import type { ScreeningProgress } from '@avanzare/engine';
import { avz } from '../api';

export default function Running({ label }: { label: string }) {
  const [p, setP] = useState<ScreeningProgress | null>(null);

  useEffect(() => avz.onProgress(setP), []);

  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="panel">
      <h2>{label}…</h2>
      <div className="progress-outer" style={{ marginTop: 12 }}>
        <div className="progress-inner" style={{ width: `${pct}%` }} />
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        {p ? `${p.done} / ${p.total}${p.currentFile ? ` — ${p.currentFile}` : ''}` : 'Starting…'}
      </p>
    </div>
  );
}
