'use client';

import { useState, useEffect, useRef } from 'react';

// Click-to-edit grid cell. No inline-edit component existed anywhere in
// this frontend before this — every existing table (Candidates, Resume
// Inbox) edits through a separate modal instead. This is the one genuinely
// new UI primitive the Sourcing Tracker needs; everything else reuses
// existing endpoints/patterns as-is.

interface Option { value: string; label: string; }

interface Props {
  value: string;
  onSave: (value: string) => Promise<void>;
  variant?: 'text' | 'number' | 'select' | 'skills';
  options?: Option[];
  placeholder?: string;
  disabled?: boolean;
  disabledTooltip?: string;
  display?: React.ReactNode; // custom read-mode rendering; falls back to `value`
}

export function EditableCell({ value, onSave, variant = 'text', options, placeholder, disabled, disabledTooltip, display }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = async () => {
    if (draft === (value ?? '')) { setEditing(false); return; }
    setSaving(true); setError('');
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { setDraft(value ?? ''); setEditing(false); setError(''); };

  if (disabled) {
    return (
      <span title={disabledTooltip} style={{ color: '#94a3b8', fontSize: 12, cursor: 'default' }}>
        {display ?? value ?? '—'}
      </span>
    );
  }

  if (!editing) {
    return (
      <div onClick={() => setEditing(true)} style={{ cursor: 'text', minHeight: 18, fontSize: 12, padding: '2px 4px', borderRadius: 4 }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        {display ?? (value || <span style={{ color: '#cbd5e1' }}>{placeholder || '— click to edit —'}</span>)}
      </div>
    );
  }

  const shared = {
    ref: inputRef as any,
    value: draft,
    onChange: (e: any) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); },
    style: { width: '100%', fontSize: 12, padding: '3px 5px', border: '1px solid #2563eb', borderRadius: 4, outline: 'none' },
    disabled: saving,
  };

  return (
    <div>
      {variant === 'select' ? (
        <select {...shared}>
          <option value="">—</option>
          {(options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input {...shared} type={variant === 'number' ? 'number' : 'text'} placeholder={placeholder} />
      )}
      {error && <div style={{ color: '#ef4444', fontSize: 10, marginTop: 2 }}>{error}</div>}
    </div>
  );
}
