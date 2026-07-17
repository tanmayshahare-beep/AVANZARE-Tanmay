import { useState } from 'react';
import { avz, call } from '../api';

interface Props {
  candidateId: number;
  name: string;
  email: string | null;
  phone: string | null;
  onSaved: (v: { name: string; email: string | null; phone: string | null }) => void;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

/**
 * Contact info with inline editing — extraction is heuristic (and OCR will make
 * it worse), so fixing a name or missing email in place beats re-uploading.
 */
export default function ContactCell({ candidateId, name, email, phone, onSaved, notify }: Props) {
  const [editing, setEditing] = useState(false);
  const [n, setN] = useState(name);
  const [e, setE] = useState(email ?? '');
  const [ph, setPh] = useState(phone ?? '');

  const save = async () => {
    if (!n.trim()) { notify('Name cannot be empty.'); return; }
    if (e.trim() && !e.includes('@')) { notify('That email address does not look valid.'); return; }
    const payload = { candidateId, name: n.trim(), email: e.trim() || null, phone: ph.trim() || null };
    const res = await avz.updateContact(payload);
    if (!res.ok) { notify(res.error.message); return; }
    onSaved({ name: payload.name, email: payload.email, phone: payload.phone });
    setEditing(false);
    notify('Contact updated.', 'info');
  };

  if (editing) {
    return (
      <div className="contact-edit">
        <input type="text" value={n} placeholder="Name" onChange={ev => setN(ev.target.value)} />
        <input type="text" value={e} placeholder="Email" onChange={ev => setE(ev.target.value)} />
        <input type="text" value={ph} placeholder="Phone" onChange={ev => setPh(ev.target.value)} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn small primary" onClick={() => void save()}>Save</button>
          <button className="btn small" onClick={() => { setEditing(false); setN(name); setE(email ?? ''); setPh(phone ?? ''); }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <strong>{name}</strong>
      <button className="linklike" style={{ marginLeft: 6, fontSize: 12 }} title="Edit contact info"
        onClick={() => setEditing(true)}>✎</button>
      <div className="sub">{email ?? <span className="badge warn">no email found</span>}</div>
      {phone && <div className="sub">{phone}</div>}
    </div>
  );
}
