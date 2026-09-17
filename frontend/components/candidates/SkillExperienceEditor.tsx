'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/useFetch';

// Editor for candidate_skill_experience rows (skill/project history).
// GET/PUT /candidates/{id}/skill-experience is a full-replace contract —
// the whole set is fetched on open and saved as one PUT, matching the
// backend's own delete+reinsert transaction. Kept as a standalone
// component (not extracted from the existing inline block in
// candidates/page.tsx) so this build doesn't touch that live, heavily-used
// page — both places call the identical backend endpoint, so there's one
// real implementation of the actual logic, just two small renderings of it.

export const ROLE_TYPES = ['Implementation', 'Support', 'Enhancement', 'Rollout'];

const EMPTY_ROW = { skill_name: '', project_name: '', duration_from: '', duration_to: '', role_types: [] as string[], relevant_experience: '', last_used: '' };

const INP: any = { width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', outline: 'none', color: '#1e293b', background: 'white', boxSizing: 'border-box' };

interface Props {
  candidateId: string;
  onSaved?: () => void;
}

export function SkillExperienceEditor({ candidateId, onSaved }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_ROW });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/candidates/${candidateId}/skill-experience`)
      .then((res: any) => { if (!cancelled) setRows(res.rows || []); })
      .catch(() => { /* non-blocking */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidateId]);

  const addRow = () => {
    if (!form.skill_name.trim()) return;
    setRows(r => [...r, { ...form }]);
    setForm({ ...EMPTY_ROW });
  };
  const removeRow = (i: number) => setRows(r => r.filter((_, idx) => idx !== i));
  const toggleRole = (r: string) => setForm(f => ({ ...f, role_types: f.role_types.includes(r) ? f.role_types.filter(x => x !== r) : [...f.role_types, r] }));

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/candidates/${candidateId}/skill-experience`, { method: 'PUT', body: JSON.stringify(rows) });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>Loading project history…</div>;

  return (
    <div>
      {rows.length > 0 && (
        <div style={{ marginBottom: 12, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 12 }}>
              <div>
                <b>{r.skill_name}</b>{r.project_name ? ` — ${r.project_name}` : ''}
                <div style={{ color: '#64748b', fontSize: 11 }}>
                  {[r.duration_from, r.duration_to].filter(Boolean).join(' – ')}{r.relevant_experience ? ` · ${r.relevant_experience}` : ''}
                  {r.role_types?.length ? ` · ${r.role_types.join(', ')}` : ''}
                </div>
              </div>
              <button type="button" onClick={() => removeRow(i)} style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input style={INP} placeholder="Skill / Technology (e.g. SAP FICO)" value={form.skill_name} onChange={e => setForm(f => ({ ...f, skill_name: e.target.value }))} />
        <input style={INP} placeholder="Project Name" value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} />
        <input style={INP} placeholder="Duration From (e.g. Jan 2024)" value={form.duration_from} onChange={e => setForm(f => ({ ...f, duration_from: e.target.value }))} />
        <input style={INP} placeholder="Duration To (e.g. Current)" value={form.duration_to} onChange={e => setForm(f => ({ ...f, duration_to: e.target.value }))} />
        <input style={INP} placeholder="Relevant Experience (e.g. 8 Years)" value={form.relevant_experience} onChange={e => setForm(f => ({ ...f, relevant_experience: e.target.value }))} />
        <input style={INP} placeholder="Last Used (e.g. Current / 2023)" value={form.last_used} onChange={e => setForm(f => ({ ...f, last_used: e.target.value }))} />
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 11, color: '#374151' }}>
        {ROLE_TYPES.map(r => (
          <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.role_types.includes(r)} onChange={() => toggleRole(r)} />{r}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <button type="button" onClick={addRow} disabled={!form.skill_name.trim()}
          style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: form.skill_name.trim() ? '#1e40af' : '#94a3b8', color: 'white', cursor: form.skill_name.trim() ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700 }}>
          + Add Row
        </button>
        <button type="button" onClick={save} disabled={saving}
          style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: '#16a34a', color: 'white', cursor: saving ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save Project Details'}
        </button>
      </div>
    </div>
  );
}
