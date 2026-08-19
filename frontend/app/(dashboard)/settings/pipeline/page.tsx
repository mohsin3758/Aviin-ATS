'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { KanbanSquare, ArrowUp, ArrowDown, Eye, EyeOff, Save, RotateCcw, GripVertical, Plus, Trash2, Zap, ToggleLeft, ToggleRight, Lock, Star, X } from 'lucide-react';

interface StageRow {
  stage_key: string;
  label: string;
  color: string;
  display_order: number;
  is_visible: boolean;
  is_custom?: boolean;
  deletable?: boolean;
  is_default_add?: boolean;
}

const SWATCHES = ['#6366F1', '#06B6D4', '#3B82F6', '#F59E0B', '#0891B2', '#64748B', '#7C3AED', '#9333EA', '#CA8A04', '#059669', '#16A34A', '#94A3B8', '#DC2626', '#EC4899', '#14B8A6'];

export default function PipelineStagesSettings() {
  const { data, refetch } = useFetch<StageRow[]>('/settings/pipeline-stages');
  const [rows, setRows] = useState<StageRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(SWATCHES[0]);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

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

  async function addStage() {
    if (!newLabel.trim()) return;
    setAddingStage(true); setMsg(null);
    try {
      await apiFetch('/settings/pipeline-stages', { method: 'POST', body: JSON.stringify({ label: newLabel.trim(), color: newColor }) });
      setMsg({ text: `"${newLabel.trim()}" stage added`, ok: true });
      setNewLabel(''); setNewColor(SWATCHES[0]);
      refetch();
    } catch (e: any) {
      setMsg({ text: e?.message || 'Add stage failed', ok: false });
    } finally { setAddingStage(false); }
  }

  async function deleteStage(key: string, label: string) {
    if (!confirm(`Delete the "${label}" stage? This only works if no candidates are currently in it.`)) return;
    setDeletingKey(key); setMsg(null);
    try {
      await apiFetch(`/settings/pipeline-stages/${key}`, { method: 'DELETE' });
      setMsg({ text: `"${label}" stage deleted`, ok: true });
      refetch();
    } catch (e: any) {
      setMsg({ text: e?.message || 'Delete failed', ok: false });
    } finally { setDeletingKey(null); }
  }

  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  async function setDefaultAddStage(key: string, label: string) {
    setSettingDefault(key); setMsg(null);
    try {
      await apiFetch('/settings/pipeline-stages/default-add-stage', { method: 'PUT', body: JSON.stringify({ stage_key: key }) });
      setMsg({ text: `New candidates now default to "${label}"`, ok: true });
      refetch();
    } catch (e: any) {
      setMsg({ text: e?.message || 'Failed to set default', ok: false });
    } finally { setSettingDefault(null); }
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
            Reorder, rename, recolor, hide, or delete stages on the Kanban board — the name field is your own terminology, it's used everywhere the stage appears. Only <b>Sourced</b>, <b>Rejected</b>, and <b>Placed</b> can't be deleted (only hidden), since other features are wired to those three exact stages; every other stage, built-in or custom, can be removed once no one is currently in it.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 12, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        Want to change the automated email/WhatsApp text sent when a candidate enters a stage? That's a separate per-stage message editor:
        <a href="/settings/email" style={{ color: '#1e40af', fontWeight: 700, textDecoration: 'underline' }}>Email templates</a>
        <span>·</span>
        <a href="/whatsapp" style={{ color: '#1e40af', fontWeight: 700, textDecoration: 'underline' }}>WhatsApp templates</a>
      </div>

      <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
        <b>Default for new candidates</b> — click the star on any visible stage to make it the one "Add Candidate to Pipeline" uses when you're not already looking at a specific stage's column (opening it from a specific stage tab still adds there instead).
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

            <button onClick={() => !r.is_default_add && r.is_visible && setDefaultAddStage(r.stage_key, r.label)}
              disabled={settingDefault === r.stage_key || r.is_default_add || !r.is_visible}
              title={r.is_default_add ? 'Default for new candidates' : r.is_visible ? 'Click to make this the default for new candidates' : 'Hidden stages can\'t be the default — show it first'}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderRadius: 6, border: '1px solid ' + (r.is_default_add ? '#fde68a' : '#e2e8f0'), background: r.is_default_add ? '#fffbeb' : '#fff', color: r.is_default_add ? '#b45309' : '#cbd5e1', fontSize: 11, fontWeight: 600, cursor: r.is_default_add || !r.is_visible ? 'default' : 'pointer', flexShrink: 0, opacity: !r.is_visible ? 0.4 : 1 }}>
              <Star size={12} fill={r.is_default_add ? '#f59e0b' : 'none'} />
            </button>

            <button onClick={() => updateRow(r.stage_key, { is_visible: !r.is_visible })}
              title={r.is_visible ? 'Visible on board — click to hide' : 'Hidden from board — click to show'}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: r.is_visible ? '#f0fdf4' : '#f8fafc', color: r.is_visible ? '#16a34a' : '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
              {r.is_visible ? <Eye size={12} /> : <EyeOff size={12} />} {r.is_visible ? 'Visible' : 'Hidden'}
            </button>

            {r.deletable !== false ? (
              <button onClick={() => deleteStage(r.stage_key, r.label)} disabled={deletingKey === r.stage_key}
                title="Delete this stage (only works if no candidates are currently in it)"
                style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, padding: 0 }}>
                <Trash2 size={12} style={{ color: '#dc2626' }} />
              </button>
            ) : (
              <div title={`"${r.label}" can only be hidden, not deleted — ${r.stage_key === 'placed' ? 'offer acceptance sets this stage directly' : r.stage_key === 'sourced' ? 'every new candidate starts in this stage' : 'rejecting a candidate is gated to this exact stage'}`}
                style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Lock size={11} style={{ color: '#94a3b8' }} />
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
        )}
      </div>

      <div style={{ background: 'white', borderRadius: 12, border: '1px dashed #cbd5e1', padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Add a New Stage
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setColorPickerFor(p => p === '__new__' ? null : '__new__')}
              style={{ width: 30, height: 30, borderRadius: 6, background: newColor, border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }} />
            {colorPickerFor === '__new__' && (
              <div style={{ position: 'absolute', top: 34, left: 0, zIndex: 20, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, width: 130 }}>
                {SWATCHES.map(sw => (
                  <button key={sw} onClick={() => { setNewColor(sw); setColorPickerFor(null); }}
                    style={{ width: 20, height: 20, borderRadius: 5, background: sw, border: sw === newColor ? '2px solid #0f172a' : '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }} />
                ))}
              </div>
            )}
          </div>
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Panel Interview, Background Check"
            onKeyDown={e => e.key === 'Enter' && addStage()}
            style={{ flex: 1, minWidth: 220, border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#1e293b', outline: 'none' }} />
          <button onClick={addStage} disabled={addingStage || !newLabel.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', background: newLabel.trim() ? '#1e40af' : '#94a3b8', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: newLabel.trim() ? 'pointer' : 'not-allowed' }}>
            <Plus size={13} /> {addingStage ? 'Adding…' : 'Add Stage'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 22px', background: '#1e40af', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={resetDefaults} disabled={resetting} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: resetting ? 'not-allowed' : 'pointer' }}>
          <RotateCcw size={14} /> {resetting ? 'Resetting…' : 'Restore Defaults'}
        </button>
      </div>

      <AutomationRulesSection stages={rows} />
    </div>
  );
}

// ── Pipeline Automation Rules (Tier-0, evaluated nightly by the scheduler) ────
const COND_FIELDS = [
  { key: 'total_exp_mo',       label: 'Experience (months)' },
  // Real bug fix (2026-08-20): candidates.ai_match_score has no writer
  // anywhere in the backend (confirmed via a full grep) - a rule
  // configured against it can never match, silently. readiness_index
  // (from candidate_scores, the same engine behind the AI Match Score
  // panel and the Kanban board's per-card score) is the real, live
  // signal - kept ai_match_score in the list too, unchanged, so any
  // already-saved rule referencing it doesn't break, just added the
  // working field alongside it.
  { key: 'readiness_index',    label: 'AI Readiness Score (0-100)' },
  { key: 'ai_match_score',     label: 'AI Match Score (0-100) — legacy, currently always empty' },
  { key: 'fit_score',          label: 'JD Fit Score (0-100)' },
  { key: 'expected_ctc',       label: 'Expected CTC' },
  { key: 'notice_period_days', label: 'Notice Period (days)' },
];
const COND_OPS = [
  { key: '>=', label: '≥' }, { key: '<=', label: '≤' },
  { key: '>', label: '>' }, { key: '<', label: '<' },
  { key: '==', label: '=' }, { key: '!=', label: '≠' },
];
const EMPTY_RULE = { name: '', stage_from: '', stage_to: '', conditions: [{ field: 'total_exp_mo', op: '>=', value: 0 }], enabled: true };

function AutomationRulesSection({ stages }: { stages: StageRow[] }) {
  const { data: rules, refetch } = useFetch<any[]>('/pipeline-rules');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY_RULE });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const stageLabel = (key: string) => stages.find(s => s.stage_key === key)?.label || key;

  async function createRule() {
    if (!form.name.trim() || !form.stage_from || !form.stage_to) { setErr('Name, from-stage and to-stage are required'); return; }
    setSaving(true); setErr('');
    try {
      await apiFetch('/pipeline-rules', { method: 'POST', body: JSON.stringify(form) });
      setAdding(false); setForm({ ...EMPTY_RULE, conditions: [{ field: 'total_exp_mo', op: '>=', value: 0 }] }); refetch();
    } catch (e: any) { setErr(e?.message || 'Failed to create rule'); } finally { setSaving(false); }
  }

  // The backend engine (pipeline_p2.py) has always AND-chained every
  // condition in the array — this form just only ever sent one. Same
  // shape the read-side rule list already renders (see the `.join(' AND
  // ')` a few lines up), just never had an editor for it.
  function updateCondition(idx: number, patch: Partial<{ field: string; op: string; value: number }>) {
    setForm((f: any) => ({ ...f, conditions: f.conditions.map((c: any, i: number) => i === idx ? { ...c, ...patch } : c) }));
  }
  function addCondition() {
    setForm((f: any) => ({ ...f, conditions: [...f.conditions, { field: 'total_exp_mo', op: '>=', value: 0 }] }));
  }
  function removeCondition(idx: number) {
    setForm((f: any) => ({ ...f, conditions: f.conditions.filter((_: any, i: number) => i !== idx) }));
  }

  async function toggleEnabled(rule: any) {
    setBusyId(rule.id);
    try { await apiFetch(`/pipeline-rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) }); refetch(); }
    finally { setBusyId(null); }
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this automation rule?')) return;
    setBusyId(id);
    try { await apiFetch(`/pipeline-rules/${id}`, { method: 'DELETE' }); refetch(); }
    finally { setBusyId(null); }
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Zap size={16} style={{ color: '#7c3aed' }} />
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>Pipeline Automation Rules</h2>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        Auto-move candidates between stages when conditions match — evaluated nightly (zero-token, no AI involved). E.g. "Sourced → Screened when AI Match Score ≥ 70".
      </p>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 12 }}>
        {(rules || []).length === 0 && !adding && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No automation rules yet</div>
        )}
        {(rules || []).map((r: any, i: number) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: i < rules!.length - 1 ? '1px solid #f1f5f9' : 'none', opacity: r.enabled ? 1 : 0.55 }}>
            <button onClick={() => toggleEnabled(r)} disabled={busyId === r.id} style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.enabled ? '#16a34a' : '#cbd5e1', flexShrink: 0, display: 'flex' }} title={r.enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}>
              {r.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{r.name}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {stageLabel(r.stage_from)} → {stageLabel(r.stage_to)}
                {(r.conditions || []).length > 0 && (
                  <> · when {r.conditions.map((c: any, ci: number) => `${COND_FIELDS.find(f => f.key === c.field)?.label || c.field} ${COND_OPS.find(o => o.key === c.op)?.label || c.op} ${c.value}`).join(' AND ')}</>
                )}
              </div>
            </div>
            <button onClick={() => deleteRule(r.id)} disabled={busyId === r.id} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <Trash2 size={12} style={{ color: '#dc2626' }} />
            </button>
          </div>
        ))}
      </div>

      {!adding ? (
        <button onClick={() => { setAdding(true); setErr(''); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#faf5ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={13} /> New Automation Rule
        </button>
      ) : (
        <div style={{ background: 'white', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 16 }}>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Rule name, e.g. Auto-screen strong matches"
            style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: 8, outline: 'none' }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={form.stage_from} onChange={e => setForm({ ...form, stage_from: e.target.value })} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 8px', fontSize: 12 }}>
              <option value="">From stage…</option>
              {stages.map(s => <option key={s.stage_key} value={s.stage_key}>{s.label}</option>)}
            </select>
            <span style={{ alignSelf: 'center', color: '#94a3b8' }}>→</span>
            <select value={form.stage_to} onChange={e => setForm({ ...form, stage_to: e.target.value })} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 8px', fontSize: 12 }}>
              <option value="">To stage…</option>
              {stages.map(s => <option key={s.stage_key} value={s.stage_key}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>CONDITIONS (all must match)</div>
          {form.conditions.map((cond: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select value={cond.field} onChange={e => updateCondition(idx, { field: e.target.value })} style={{ flex: 2, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 8px', fontSize: 12 }}>
                {COND_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select value={cond.op} onChange={e => updateCondition(idx, { op: e.target.value })} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 8px', fontSize: 12 }}>
                {COND_OPS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <input type="number" value={cond.value} onChange={e => updateCondition(idx, { value: Number(e.target.value) })}
                style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 8px', fontSize: 12 }} />
              <button onClick={() => removeCondition(idx)} disabled={form.conditions.length === 1}
                title={form.conditions.length === 1 ? 'A rule needs at least one condition' : 'Remove this condition'}
                style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #e2e8f0', background: form.conditions.length === 1 ? '#f8fafc' : '#fef2f2', color: form.conditions.length === 1 ? '#cbd5e1' : '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: form.conditions.length === 1 ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
                <X size={12} />
              </button>
            </div>
          ))}
          <button onClick={addCondition} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'none', border: '1px dashed #cbd5e1', borderRadius: 6, color: '#7c3aed', fontSize: 11, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
            <Plus size={11} /> Add condition (AND)
          </button>
          {err && <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={createRule} disabled={saving} style={{ padding: '8px 16px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Create Rule'}</button>
            <button onClick={() => setAdding(false)} style={{ padding: '8px 14px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
