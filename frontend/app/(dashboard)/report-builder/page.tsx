'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus, Play, Trash2 } from 'lucide-react';

const ENTITY_FIELDS: Record<string, string[]> = {
  candidates: ['id', 'full_name', 'email', 'phone', 'location', 'source', 'created_at'],
  requisitions: ['id', 'title', 'location', 'status', 'employment_type', 'created_at'],
  applications: ['id', 'candidate_id', 'requisition_id', 'stage', 'fit_score', 'created_at'],
  placements: ['id', 'candidate_id', 'requisition_id', 'start_date', 'created_at'],
};

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

export default function ReportBuilderPage() {
  const { data, refetch } = useFetch<any>('/report-builder/');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', entity: 'candidates', fields: [] as string[] });
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState<string | null>(null);
  const reports = data?.reports || [];

  const toggleField = (f: string) => setForm(s => ({ ...s, fields: s.fields.includes(f) ? s.fields.filter(x => x !== f) : [...s.fields, f] }));

  const save = async () => {
    if (!form.name || !form.fields.length) return;
    await apiFetch('/report-builder/', { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false); setForm({ name: '', entity: 'candidates', fields: [] }); refetch();
  };
  const run = async (id: string) => {
    setRunning(id);
    try { setResult(await apiFetch(`/report-builder/${id}/run`, { method: 'POST' })); }
    finally { setRunning(null); }
  };
  const del = async (id: string) => { await apiFetch(`/report-builder/${id}`, { method: 'DELETE' }); refetch(); };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Report Builder</h1>
          <p style={{ fontSize: 13, color: '#64748B' }}>Build and save simple ad-hoc reports across candidates, requisitions, applications, and placements.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} style={{ ...btn, display: 'flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> New Report</button>
      </div>
      {showForm && (
        <div style={card}>
          <label style={label}>NAME</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={input} />
          <label style={label}>ENTITY</label>
          <select value={form.entity} onChange={e => setForm({ ...form, entity: e.target.value, fields: [] })} style={input}>
            {Object.keys(ENTITY_FIELDS).map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <label style={label}>FIELDS</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {ENTITY_FIELDS[form.entity].map(f => (
              <label key={f} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                <input type="checkbox" checked={form.fields.includes(f)} onChange={() => toggleField(f)} /> {f}
              </label>
            ))}
          </div>
          <button onClick={save} style={btn}>Save Report</button>
        </div>
      )}
      <div style={card}>
        {reports.map((r: any) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1, fontWeight: 700 }}>{r.name}</span>
            <span style={{ color: '#64748B' }}>{r.entity}</span>
            <button onClick={() => run(r.id)} disabled={running === r.id} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563EB', display: 'flex', gap: 4, alignItems: 'center' }}>
              <Play size={12} /> {running === r.id ? 'Running…' : 'Run'}
            </button>
            <button onClick={() => del(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><Trash2 size={12} /></button>
          </div>
        ))}
        {!reports.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No saved reports yet.</div>}
      </div>
      {result && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{result.entity} — {result.rows.length} rows</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr>{result.fields.map((f: string) => <th key={f} style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>{f}</th>)}</tr></thead>
            <tbody>
              {result.rows.map((row: any, i: number) => (
                <tr key={i}>{result.fields.map((f: string) => <td key={f} style={{ padding: 6, borderBottom: '1px solid #F1F5F9' }}>{String(row[f] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
