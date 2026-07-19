'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { MessageSquare, Mail, Clock, Zap, ChevronUp, ChevronDown } from 'lucide-react';

const TRIGGERS = [
  { value: 'offer_made', label: 'Offer Made' },
  { value: 'offer_accepted', label: 'Offer Accepted' },
  { value: 'interview_scheduled', label: 'Interview Scheduled' },
  { value: 'candidate_placed', label: 'Candidate Placed' },
  { value: 'candidate_rejected', label: 'Candidate Rejected' },
  { value: 'application_received', label: 'Application Received' },
  { value: 'manual', label: 'Manual Trigger' },
];

const STEP_TYPES = ['email', 'whatsapp', 'sms'];

function StepEditor({ steps, onChange }: { steps: any[]; onChange: (s: any[]) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 90px 1fr auto', gap: '8px', alignItems: 'start' }}>
          <div>
            <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Day</label>
            <input type="number" value={step.day ?? 0} min={0}
              onChange={e => { const s = [...steps]; s[i] = { ...s[i], day: +e.target.value }; onChange(s); }}
              style={{ width: '100%', padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }} />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Channel</label>
            <select value={step.type || step.channel || 'email'}
              onChange={e => { const s = [...steps]; s[i] = { ...s[i], type: e.target.value, channel: e.target.value }; onChange(s); }}
              style={{ width: '100%', padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }}>
              {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Message template</label>
            <textarea value={step.template || ''} rows={2}
              onChange={e => { const s = [...steps]; s[i] = { ...s[i], template: e.target.value }; onChange(s); }}
              style={{ width: '100%', padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box' }}
              placeholder="Hi {name}, your interview is confirmed..." />
          </div>
          <button onClick={() => onChange(steps.filter((_, j) => j !== i))}
            style={{ marginTop: '22px', padding: '7px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
            x
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...steps, { day: (steps[steps.length - 1]?.day ?? -1) + 1, type: 'email', channel: 'email', template: '' }])}
        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', background: '#f1f5f9', color: '#374151', border: '1px dashed #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', width: 'fit-content' }}>
        + Add Step
      </button>
    </div>
  );
}

function CreateModal({ onClose, onCreated }: any) {
  const [form, setForm] = useState({ name: '', trigger_event: 'offer_made', steps: [{ day: 0, type: 'email', channel: 'email', template: '' }] });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) { alert('Name is required'); return; }
    setSaving(true);
    try {
      await apiFetch('/nurture', { method: 'POST', body: JSON.stringify(form) });
      onCreated();
      onClose();
    } catch (e: any) {
      alert(e.message || 'Failed to create sequence');
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '14px', padding: '28px', maxWidth: '700px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginBottom: '20px' }}>New Nurture Sequence</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '5px' }}>Sequence Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Post-Interview Follow-up"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '5px' }}>Trigger Event</label>
            <select value={form.trigger_event} onChange={e => setForm({ ...form, trigger_event: e.target.value })}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px' }}>
              {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '10px' }}>Steps</label>
          <StepEditor steps={form.steps} onChange={steps => setForm({ ...form, steps })} />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', background: 'white', color: '#374151', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{ padding: '9px 18px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Creating...' : 'Create Sequence'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NurturePage() {
  const { data: seqs, loading, refetch } = useFetch<any[]>('/nurture');
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const [seeding, setSeeding] = useState(false);

  const rows: any[] = Array.isArray(seqs) ? seqs : [];

  async function runNow(seq: any) {
    setRunning(seq.id);
    try {
      const r = await apiFetch('/nurture/' + seq.id + '/run-now', { method: 'POST' });
      setResults(prev => ({ ...prev, [seq.id]: r }));
    } catch (e: any) {
      alert(e.message || 'Failed to run sequence');
    } finally { setRunning(null); }
  }

  async function seedDefaults() {
    setSeeding(true);
    try {
      await apiFetch('/nurture/seed-defaults', { method: 'POST' });
      refetch();
    } catch { } finally { setSeeding(false); }
  }

  const triggerLabel = (v: string) => TRIGGERS.find(t => t.value === v)?.label || v;

  return (
    <div style={{ maxWidth: '860px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: 0 }}>Nurture Sequences</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>Automated candidate engagement campaigns</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={seedDefaults} disabled={seeding}
            style={{ padding: '9px 16px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', opacity: seeding ? 0.6 : 1 }}>
            {seeding ? 'Seeding...' : 'Seed Defaults'}
          </button>
          <button onClick={() => setCreating(true)}
            style={{ padding: '9px 16px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
            + New Sequence
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '60px 20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>No sequences yet</h3>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px' }}>Seed defaults to get started.</p>
          <button onClick={seedDefaults}
            style={{ padding: '10px 20px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
            Seed Default Sequences
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {rows.map(seq => {
            const steps = typeof seq.steps === 'string' ? JSON.parse(seq.steps || '[]') : (seq.steps || []);
            const result = results[seq.id];
            return (
              <div key={seq.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>{seq.name}</h3>
                      <span style={{ padding: '3px 8px', background: seq.is_active ? '#d1fae5' : '#f1f5f9', color: seq.is_active ? '#059669' : '#64748b', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>
                        {seq.is_active ? 'ACTIVE' : 'PAUSED'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                      Trigger: <strong>{triggerLabel(seq.trigger_event)}</strong> &bull; {steps.length} step{steps.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                      {steps.map((s: any, i: number) => (
                        <span key={i} style={{ padding: '3px 8px', background: '#f1f5f9', borderRadius: '20px', fontSize: '11px', color: '#374151', fontWeight: '600' }}>
                          Day {s.day}: {s.type || s.channel || 'email'}
                        </span>
                      ))}
                    </div>
                    {result && (
                      <div style={{ marginTop: '10px', padding: '8px 12px', background: result.triggered > 0 ? '#d1fae5' : '#fef3c7', borderRadius: '6px', fontSize: '12px', color: result.triggered > 0 ? '#059669' : '#92400e', fontWeight: '600' }}>
                        {result.triggered > 0
                          ? ('Queued ' + result.triggered + ' candidate(s) for "' + result.sequence + '"')
                          : result.message}
                      </div>
                    )}
                  </div>
                  <button onClick={() => runNow(seq)} disabled={running === seq.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '9px 16px', background: running === seq.id ? '#94a3b8' : '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', cursor: running === seq.id ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {running === seq.id ? 'Running...' : 'Run Now'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={refetch} />}
    </div>
  );
}

type NurtureStep = { day: number; type: 'whatsapp' | 'sms' | 'email'; template: string };
type NurtureSeq = {
  id: string; name: string; trigger_event: string;
  steps: NurtureStep[] | string; is_active: boolean;
};

const TRIGGER_LABELS: Record<string, string> = {
  offer_made: '🎁 Offer Made', offer_accepted: '✅ Offer Accepted',
  interview_scheduled: '📅 Interview Scheduled', candidate_placed: '🎉 Placed',
  candidate_rejected: '❌ Rejected', application_received: '📩 Application Received',
  daily_cron: '⏰ Daily Cron', stage_change: '🔄 Stage Change',
};

const CHANNEL_ICON: Record<string, JSX.Element> = {
  whatsapp: <MessageSquare size={12} style={{ color: '#25d366' }} />,
  sms: <MessageSquare size={12} style={{ color: '#3b82f6' }} />,
  email: <Mail size={12} style={{ color: '#6366f1' }} />,
};

function parseSteps(steps: NurtureStep[] | string): NurtureStep[] {
  if (Array.isArray(steps)) return steps;
  try { return JSON.parse(steps as string); } catch { return []; }
}

function StepCard({ step, idx }: { step: NurtureStep; idx: number }) {
  const bg = step.type === 'whatsapp' ? '#f0fdf4' : step.type === 'email' ? '#eff6ff' : '#f0f9ff';
  const border = step.type === 'whatsapp' ? '#bbf7d0' : step.type === 'email' ? '#bfdbfe' : '#bae6fd';
  return (
    <div style={{ padding: '10px 14px', borderRadius: '10px', background: bg, border: `1px solid ${border}`, marginBottom: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#1e40af', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '700', flexShrink: 0 }}>
          {idx + 1}
        </div>
        {CHANNEL_ICON[step.type]}
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#374151', textTransform: 'capitalize' }}>{step.type}</span>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Clock size={9} /> Day {step.day}
        </span>
      </div>
      <p style={{ fontSize: '12px', color: '#374151', margin: 0, lineHeight: '1.5', fontStyle: 'italic' }}>
        "{step.template?.slice(0, 120)}{step.template?.length > 120 ? '…' : ''}"
      </p>
    </div>
  );
}

function CampaignCard({ seq, onToggle }: { seq: NurtureSeq; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const steps = parseSteps(seq.steps);
  const trig = TRIGGER_LABELS[seq.trigger_event] || seq.trigger_event;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden', background: 'white', marginBottom: '12px' }}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ width: '44px', height: '44px', borderRadius: '10px',
          background: seq.is_active ? 'linear-gradient(135deg,#1e40af,#6366f1)' : '#f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Zap size={20} style={{ color: seq.is_active ? 'white' : '#94a3b8' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a' }}>{seq.name}</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
            Trigger: {trig} · {steps.length} step{steps.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700',
            background: seq.is_active ? '#d1fae5' : '#f1f5f9',
            color: seq.is_active ? '#065f46' : '#64748b' }}>
            {seq.is_active ? '● Active' : '○ Paused'}
          </span>
          <button onClick={onToggle}
            style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', border: 'none',
              background: seq.is_active ? '#fee2e2' : '#d1fae5',
              color: seq.is_active ? '#dc2626' : '#059669', cursor: 'pointer' }}>
            {seq.is_active ? 'Pause' : 'Activate'}
          </button>
          <button onClick={() => setOpen(!open)}
            style={{ padding: '6px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer' }}>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      {open && steps.length > 0 && (
        <div style={{ padding: '0 20px 16px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '10px', marginTop: '12px' }}>
            Sequence Steps ({steps.length})
          </div>
          {steps.map((s, i) => <StepCard key={i} step={s} idx={i} />)}
        </div>
      )}
    </div>
  );
}

type FormStep = { day: string; type: string; template: string };

