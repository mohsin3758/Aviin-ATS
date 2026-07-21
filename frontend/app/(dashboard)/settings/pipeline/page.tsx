'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { KanbanSquare, ArrowUp, ArrowDown, Eye, EyeOff, Save, RotateCcw, GripVertical } from 'lucide-react';

interface StageRow {
  stage_key: string;
  label: string;
  color: string;
  display_order: number;
  is_visible: boolean;
}

const SWATCHES = ['#6366F1', '#06B6D4', '#3B82F6', '#F59E0B', '#0891B2', '#64748B', '#7C3AED', '#9333EA', '#CA8A04', '#059669', '#16A34A', '#94A3B8', '#DC2626', '#EC4899', '#14B8A6'];

export default function PipelineStagesSettings() {
  const { data, refetch } = useFetch<StageRow[]>('/settings/pipeline-stages');
  const [rows, setRows] = useState<StageRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);

  useEffect(() => {
    if (data) setRows([...data].sort((a, b) => a.display_order - b.display_order));
  }, [data]);

  function move(idx: number, dir: -1 | 1) {
    const next = [...rows];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setRows(next.map((r, i) => ({ ...r, display_order: i + 1 })));
  }

  function updateRow(key: string, patch: Partial<StageRow>) {
    setRows(rs => rs.map(r => r.stage_key === key ? { ...r, ...patch } : r));
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await apiFetch('/settings/pipeline-stages', { method: 'PUT', body: JSON.stringify({ stages: rows }) });
      setMsg({ text: 'Pipeline stage settings saved', ok: true });
      refetch();
    } catch (e: any) {
      setMsg({ text: e?.message || 'Save failed', ok: false });
    } finally { setSaving(false); }
  }

  async function resetDefaults() {
    setResetting(true); setMsg(null);
    try {
      await apiFetch('/settings/pipeline-stages/reset', { method: 'POST' });
      setMsg({ text: 'Restored factory defaults', ok: true });
      refetch();
    } catch (e: any) {
      setMsg({ text: e?.message || 'Reset failed', ok: false });
    } finally { setResetting(false); }
  }

  return (
    <div style={{ maxWidth: 780 }} className="anim-fade-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <KanbanSquare size={20} style={{ color: '#1e40af' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Pipeline Stages</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
            Reorder, rename, recolor, or hide stages on the Kanban board — the underlying stage never changes, so nothing else (analytics, SLA, offers) is affected.
          </p>
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: msg.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}`, fontSize: 13, color: msg.ok ? '#16a34a' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 16 }}>
        {rows.map((r, idx) => (
          <div key={r.stage_key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: idx < rows.length - 1 ? '1px solid #f1f5f9' : 'none', opacity: r.is_visible ? 1 : 0.5 }}>
            <GripVertical size={14} style={{ color: '#cbd5e1', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
              <button onClick={() => move(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: idx === 0 ? '#e2e8f0' : '#64748b', padding: 0 }}><ArrowUp size={13} /></button>
              <button onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} style={{ background: 'none', border: 'none', cursor: idx === rows.length - 1 ? 'not-allowed' : 'pointer', color: idx === rows.length - 1 ? '#e2e8f0' : '#64748b', padding: 0 }}><ArrowDown size={13} /></button>
            </div>

            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button onClick={() => setColorPickerFor(p => p === r.stage_key ? null : r.stage_key)}
                title="Change color"
                style={{ width: 22, height: 22, borderRadius: 6, background: r.color, border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }} />
              {colorPickerFor === r.stage_key && (
                <div style={{ position: 'absolute', top: 28, left: 0, zIndex: 20, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, width: 130 }}>
                  {SWATCHES.map(sw => (
                    <button key={sw} onClick={() => { updateRow(r.stage_key, { color: sw }); setColorPickerFor(null); }}
                      style={{ width: 20, height: 20, borderRadius: 5, background: sw, border: sw === r.color ? '2px solid #0f172a' : '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }} />
                  ))}
                </div>
              )}
            </div>

            <input value={r.label} onChange={e => updateRow(r.stage_key, { label: e.target.value })}
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 13, fontWeight: 600, color: '#1e293b', outline: 'none', minWidth: 0 }} />

            <code style={{ fontSize: 10, color: '#94a3b8', background: '#f8fafc', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>{r.stage_key}</code>

            <button onClick={() => updateRow(r.stage_key, { is_visible: !r.is_visible })}
              title={r.is_visible ? 'Visible on board — click to hide' : 'Hidden from board — click to show'}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: r.is_visible ? '#f0fdf4' : '#f8fafc', color: r.is_visible ? '#16a34a' : '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
              {r.is_visible ? <Eye size={12} /> : <EyeOff size={12} />} {r.is_visible ? 'Visible' : 'Hidden'}
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 22px', background: '#1e40af', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={resetDefaults} disabled={resetting} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: resetting ? 'not-allowed' : 'pointer' }}>
          <RotateCcw size={14} /> {resetting ? 'Resetting…' : 'Restore Defaults'}
        </button>
      </div>
    </div>
  );
}
