'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormRow, SectionDivider, FormActions } from '@/components/ui/Modal';
import { Plus, Search, Briefcase, MapPin, Users, Eye, Edit, Trash2, Calendar, DollarSign, Clock , Link2, Copy } from 'lucide-react';

const SKILLS_LIST = [
  'Python','Java','React','Node.js','FastAPI','Django','AWS','Docker','Kubernetes',
  'PostgreSQL','MongoDB','TypeScript','Go','DevOps','Machine Learning','Data Science',
  'Salesforce','Angular','Vue.js','Spring Boot','Microservices','REST APIs',
  'QA Automation','Business Analysis','IT Recruitment','Talent Acquisition',
  'SAP','Oracle','Power BI','Tableau','Azure','GCP','Terraform','Jenkins','Git',
  'Redis','Elasticsearch','Kafka','RabbitMQ','C#','.NET','PHP','Laravel',
  'Flutter','React Native','iOS','Android','Blockchain','Cybersecurity',
  'SIEM','Penetration Testing',
];

const EMPTY_FORM = {
  title: '', client_name: '', industry: '', priority: 'medium',
  employment_type: 'contract', work_mode: 'onsite', shift_type: 'day',
  positions_count: 1,
  location: '', expected_start_date: '', deadline: '', sla_hours: '' as any,
  experience_min: 0, experience_max: 10, notice_period_max: 60,
  education_required: '',
  budget_min: '' as any, budget_max: '' as any, bill_rate: '' as any,
  skills_required: [] as string[],
  description: '',
};

const TYPE_BADGE: Record<string, string> = {
  contract: 'badge-blue', fulltime: 'badge-green', c2h: 'badge-purple',
  fte: 'badge-teal', part_time: 'badge-gray',
};
const STATUS_BADGE: Record<string, string> = {
  open: 'badge-green', on_hold: 'badge-amber', filled: 'badge-blue', closed: 'badge-gray',
};
const PRIORITY_CONFIG: Record<string, { emoji: string; color: string; bg: string; border: string }> = {
  high:   { emoji: '🔴', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  medium: { emoji: '🟡', color: '#ca8a04', bg: '#fefce8', border: '#fde68a' },
  low:    { emoji: '🟢', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
};
const WORK_MODE_CONFIG: Record<string, { color: string; bg: string }> = {
  onsite: { color: '#2563eb', bg: '#eff6ff' },
  remote: { color: '#7c3aed', bg: '#f5f3ff' },
  hybrid: { color: '#0891b2', bg: '#ecfeff' },
};

function daysRemaining(deadline: string | null, clientNow?: number): number | null {
  if (!deadline || !clientNow) return null;
  const diff = new Date(deadline).getTime() - clientNow;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function fmtLakh(val: number): string {
  if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return String(val);
}

function JobCard({ req, onEdit, onDelete, counts }: { req: any; onEdit: (r: any) => void; onDelete: (id: string) => void; counts?: any }) {
  const [hover, setHover] = useState(false);
  const [copied, setCopied] = useState(false);

  function shareShortlist(e: React.MouseEvent) {
    e.stopPropagation();
    // token = base64url(tenantId:reqId) — decoded by /client-portal/view/:token
    const tenantId = req.tenant_id || '';
    const token = btoa(tenantId + ':' + req.id).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    const url = window.location.origin + '/client-portal/' + token;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  }
  const pri = PRIORITY_CONFIG[req.priority] || PRIORITY_CONFIG.medium;
  const wm = WORK_MODE_CONFIG[req.work_mode] || WORK_MODE_CONFIG.onsite;
  const [clientNow, setClientNow] = useState<number|undefined>(undefined);
  useEffect(() => { setClientNow(Date.now()); }, []);
  const days = daysRemaining(req.deadline, clientNow);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'white', border: `1px solid ${hover ? '#2563eb' : '#e2e8f0'}`,
        borderRadius: '12px', padding: '18px 20px',
        boxShadow: hover ? '0 4px 12px rgba(37,99,235,0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.15s', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{
          width: '44px', height: '44px', borderRadius: '10px',
          background: '#eff6ff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          <Briefcase size={20} style={{ color: '#2563eb' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginRight: '2px' }}>{req.title}</h3>
            <span className={`badge ${TYPE_BADGE[req.employment_type] || 'badge-gray'}`} style={{ fontSize: '10px' }}>
              {req.employment_type}
            </span>
            <span className={`badge ${STATUS_BADGE[req.status] || 'badge-gray'}`} style={{ fontSize: '10px' }}>
              {req.status}
            </span>
          </div>
          {req.client_name && (
            <div style={{ fontSize: '12px', color: '#475569', fontWeight: '500', marginTop: '2px' }}>
              {req.client_name}{req.industry ? ` · ${req.industry}` : ''}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '5px', flexWrap: 'wrap' }}>
            {req.location && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b' }}>
                <MapPin size={11} /> {req.location}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b' }}>
              <Users size={11} /> {req.positions_count} pos.
            </span>
            {(req.experience_min != null || req.experience_max != null) && (
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {req.experience_min ?? 0}–{req.experience_max ?? 10} yrs
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Badges row: priority, work_mode, deadline */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        {req.priority && (
          <span style={{
            fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '6px',
            background: pri.bg, color: pri.color, border: `1px solid ${pri.border}`,
          }}>
            {pri.emoji} {req.priority.charAt(0).toUpperCase() + req.priority.slice(1)}
          </span>
        )}
        {req.work_mode && (
          <span style={{
            fontSize: '11px', fontWeight: '500', padding: '2px 8px', borderRadius: '6px',
            background: wm.bg, color: wm.color, border: `1px solid ${wm.color}30`,
          }}>
            {req.work_mode.charAt(0).toUpperCase() + req.work_mode.slice(1)}
          </span>
        )}
        {req.budget_min && req.budget_max && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            fontSize: '11px', fontWeight: '500', padding: '2px 8px', borderRadius: '6px',
            background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0',
          }}>
            <DollarSign size={10} />
            Rs.{fmtLakh(req.budget_min)} – Rs.{fmtLakh(req.budget_max)}
          </span>
        )}
        {days !== null && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            fontSize: '11px', fontWeight: '500', padding: '2px 8px', borderRadius: '6px',
            background: days < 0 ? '#fef2f2' : days <= 7 ? '#fefce8' : '#f0fdf4',
            color: days < 0 ? '#dc2626' : days <= 7 ? '#ca8a04' : '#15803d',
            border: `1px solid ${days < 0 ? '#fecaca' : days <= 7 ? '#fde68a' : '#bbf7d0'}`,
          }}>
            <Clock size={10} />
            {days < 0 ? `🔴 Overdue (${Math.abs(days)}d)` : days === 0 ? '⚠️ Due today' : days <= 1 ? `⚠️ ${days}d left` : `${days} days left`}
          </span>
        )}
      </div>

      {/* Skills */}
      {(req.skills_required || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {(req.skills_required || []).slice(0, 5).map((s: string) => (
            <span key={s} style={{
              fontSize: '10px', fontWeight: '500', padding: '2px 8px',
              borderRadius: '5px', background: '#eff6ff', color: '#2563eb',
              border: '1px solid #bfdbfe',
            }}>{s}</span>
          ))}
          {(req.skills_required || []).length > 5 && (
            <span style={{
              fontSize: '10px', padding: '2px 7px', borderRadius: '5px',
              background: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0',
            }}>+{req.skills_required.length - 5} more</span>
          )}
        </div>
      )}

      {/* Description preview */}
      {req.description && (
        <p style={{
          fontSize: '12px', color: '#64748b', lineHeight: '1.5',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any,
        }}>
          {req.description}
        </p>
      )}

      {/* Mini Pipeline Bar — inbox matches + pipeline stages */}
      {counts && (counts.inbox_count > 0 || counts.total > 0) && (() => {
        const stages: {key:string;label:string;color:string;count:number}[] = counts.stages || [];
        const active = stages.filter((s:any) => s.count > 0);
        return (
          <div style={{ borderTop:'1px solid #f1f5f9', paddingTop:10, marginTop:4 }}>
            {/* Row 1: inbox vs pipeline counts */}
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
              {/* Inbox badge */}
              <a href={`/resume-inbox?req=${req.id}`} style={{ textDecoration:'none' }}>
                <div style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#7c3aed', cursor:'pointer' }} title="Resumes auto-matched to this JD from inbox">
                  <span style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{counts.inbox_count||0}</span>
                  <span style={{ fontSize:9, fontWeight:600, color:'#e9d5ff', textTransform:'uppercase', letterSpacing:'0.05em' }}>📬 Inbox</span>
                </div>
              </a>
              {/* Pipeline badge */}
              <a href={`/pipeline?job=${req.id}`} style={{ textDecoration:'none' }}>
                <div style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#1e40af', cursor:'pointer' }} title="Candidates formally in pipeline stages">
                  <span style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{counts.total}</span>
                  <span style={{ fontSize:9, fontWeight:600, color:'#93c5fd', textTransform:'uppercase', letterSpacing:'0.05em' }}>🔄 Pipeline</span>
                </div>
              </a>
              {/* Stage pills */}
              {active.map(s => (
                <div key={s.key} style={{ display:'flex', alignItems:'center', gap:2, padding:'2px 7px', borderRadius:10, background:s.color+'14', border:`1px solid ${s.color}30` }}>
                  <span style={{ fontSize:11, fontWeight:800, color:s.color }}>{s.count}</span>
                  <span style={{ fontSize:9, fontWeight:500, color:s.color }}>{s.label}</span>
                </div>
              ))}
              {counts.rejected > 0 && (
                <span style={{ fontSize:10, color:'#94a3b8', marginLeft:'auto' }}>{counts.rejected} ✗</span>
              )}
            </div>
            {/* Row 2: Pipeline funnel — prominent segmented bar */}
            {counts.total > 0 && (
              <div style={{ marginTop:6 }}>
                <div style={{ fontSize:9, fontWeight:700, color:'#94a3b8', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:5 }}>
                  Pipeline Funnel — {counts.total} candidate{counts.total!==1?'s':''}
                </div>
                <div style={{ display:'flex', borderRadius:6, overflow:'hidden', height:14, gap:'1px', background:'#e2e8f0' }}>
                  {stages.map(s => s.count > 0 ? (
                    <div key={s.key} title={`${s.label}: ${s.count}`}
                      style={{ background:s.color, flex:s.count, minWidth:6 }} />
                  ) : null)}
                </div>
                <div style={{ display:'flex', gap:'6px 12px', marginTop:6, flexWrap:'wrap' }}>
                  {active.map(s => (
                    <div key={s.key} style={{ display:'flex', alignItems:'center', gap:3 }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:s.color, flexShrink:0 }} />
                      <span style={{ fontSize:10, fontWeight:700, color:s.color }}>{s.count}</span>
                      <span style={{ fontSize:10, color:'#64748b' }}>{s.label}</span>
                    </div>
                  ))}
                  {counts.rejected > 0 && (
                    <div style={{ display:'flex', alignItems:'center', gap:3, marginLeft:'auto' }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:'#ef4444', flexShrink:0 }} />
                      <span style={{ fontSize:10, fontWeight:700, color:'#ef4444' }}>{counts.rejected}</span>
                      <span style={{ fontSize:10, color:'#64748b' }}>Rejected</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

            {/* Actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        paddingTop: '10px', borderTop: '1px solid #f1f5f9',
      }}>
        <a href={`/pipeline?job=${req.id}`} style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          fontSize: '12px', fontWeight: '600', color: '#2563eb',
          textDecoration: 'none', background: '#eff6ff',
          padding: '5px 12px', borderRadius: '6px',
          border: '1px solid #bfdbfe',
        }}>
          <Eye size={12} /> View Pipeline
        </a>
        <button onClick={shareShortlist} title="Copy client shortlist link" style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          fontSize: '12px', fontWeight: '600',
          color: copied ? '#15803d' : '#7c3aed',
          background: copied ? '#f0fdf4' : '#faf5ff',
          border: copied ? '1px solid #bbf7d0' : '1px solid #ddd6fe',
          padding: '5px 10px', borderRadius: '6px', cursor: 'pointer',
        }}>
          {copied ? <><Copy size={11}/> Copied!</> : <><Link2 size={11}/> Share</>}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          <button onClick={e => { e.stopPropagation(); onEdit(req); }} style={{
            width: '30px', height: '30px', borderRadius: '7px',
            border: '1px solid #e2e8f0', background: '#f8fafc',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <Edit size={13} style={{ color: '#64748b' }} />
          </button>
          <button onClick={e => { e.stopPropagation(); if (confirm('Delete this job?')) onDelete(req.id); }} style={{
            width: '30px', height: '30px', borderRadius: '7px',
            border: '1px solid #fee2e2', background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <Trash2 size={13} style={{ color: '#ef4444' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

function RequisitionsPageInner() {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [workModeFilter, setWorkModeFilter] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [error, setError] = useState('');

  const { data: rawReqs, loading, refetch } = useFetch<any>('/requisitions');
  const { data: stageCounts } = useFetch<any>('/pipeline/req-stage-counts');
  const reqs: any[] = Array.isArray(rawReqs) ? rawReqs : (rawReqs?.items || []);

  const filtered = reqs.filter(r =>
    (!search || r.title?.toLowerCase().includes(search.toLowerCase()) || r.client_name?.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || r.status === statusFilter) &&
    (!priorityFilter || r.priority === priorityFilter) &&
    (!workModeFilter || r.work_mode === workModeFilter)
  );

  const openCreate = () => {
    setForm({ ...EMPTY_FORM }); setEditId(null); setError(''); setShowModal(true);
  };

  const openEdit = (req: any) => {
    setForm({
      title: req.title || '',
      client_name: req.client_name || '',
      industry: req.industry || '',
      priority: req.priority || 'medium',
      employment_type: req.employment_type || 'contract',
      work_mode: req.work_mode || 'onsite',
      shift_type: req.shift_type || 'day',
      positions_count: req.positions_count || 1,
      location: req.location || '',
      expected_start_date: req.expected_start_date ? req.expected_start_date.substring(0, 10) : '',
      deadline: req.deadline ? req.deadline.substring(0, 10) : '',
      sla_hours: req.sla_hours ?? '',
      experience_min: req.experience_min ?? 0,
      experience_max: req.experience_max ?? 10,
      notice_period_max: req.notice_period_max ?? 60,
      education_required: req.education_required || '',
      budget_min: req.budget_min ?? '',
      budget_max: req.budget_max ?? '',
      bill_rate: req.bill_rate ?? '',
      skills_required: req.skills_required || [],
      description: req.description || '',
    });
    setEditId(req.id); setError(''); setShowModal(true);
  };

  // auto-open edit modal when URL has ?edit=<id>
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const eid = searchParams.get('edit');
    if (!eid || !reqs.length) return;
    const target = reqs.find((r) => r.id === eid);
    if (target) openEdit(target);
    router.replace('/requisitions', { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, reqs]);

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const fNum = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value === '' ? '' : Number(e.target.value) }));

  const addSkill = (skill: string) => {
    const s = skill.trim();
    if (s && !form.skills_required.includes(s))
      setForm(prev => ({ ...prev, skills_required: [...prev.skills_required, s] }));
    setSkillInput('');
  };
  const removeSkill = (s: string) =>
    setForm(prev => ({ ...prev, skills_required: prev.skills_required.filter(x => x !== s) }));

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Job title is required'); return; }
    setSaving(true); setError('');
    try {
      const payload: any = { ...form };
      // Convert empty strings to null for numeric/date fields
      ['sla_hours', 'budget_min', 'budget_max', 'bill_rate'].forEach(k => {
        if (payload[k] === '' || payload[k] === null) payload[k] = undefined;
        else payload[k] = Number(payload[k]);
      });
      ['deadline', 'expected_start_date', 'education_required', 'industry', 'client_name'].forEach(k => {
        if (payload[k] === '') payload[k] = undefined;
      });

      if (editId) {
        await apiFetch(`/requisitions/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/requisitions', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowModal(false);
      refetch();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/requisitions/${id}`, { method: 'DELETE' });
      refetch();
    } catch { }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px',
    padding: '9px 12px', fontSize: '13px', outline: 'none',
    color: '#1e293b', background: 'white', boxSizing: 'border-box',
  };

  const modalFooter = (
    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
      <button onClick={() => setShowModal(false)} style={{
        padding: '9px 20px', borderRadius: '8px', border: '1px solid #e2e8f0',
        background: 'white', fontSize: '13px', fontWeight: '500', color: '#374151', cursor: 'pointer',
      }}>Cancel</button>
      <button onClick={handleSave} disabled={saving} style={{
        padding: '9px 24px', borderRadius: '8px', border: 'none',
        background: '#1e40af', color: 'white', fontSize: '13px', fontWeight: '600',
        cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
      }}>
        {saving ? 'Saving...' : (editId ? 'Update Requirement' : 'Save Requirement')}
      </button>
    </div>
  );

  return (
    <div className="anim-fade-up">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a' }}>Jobs & Requisitions</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
            {reqs.filter(r => r.status === 'open').length} open · {reqs.length} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input placeholder="Search jobs or clients..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, paddingLeft: '30px', width: '220px', borderRadius: '20px', background: '#f8fafc' }} />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: '120px' }}>
            <option value="">All Status</option>
            {['open', 'on_hold', 'filled', 'closed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{ ...inputStyle, width: '120px' }}>
            <option value="">All Priority</option>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select>
          <select value={workModeFilter} onChange={e => setWorkModeFilter(e.target.value)} style={{ ...inputStyle, width: '120px' }}>
            <option value="">All Modes</option>
            <option value="onsite">Onsite</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <button onClick={openCreate} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '9px 18px', background: '#1e40af', color: 'white',
            border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
          }}>
            <Plus size={14} /> Add Requirement
          </button>
        </div>
      </div>

      {/* Stats pills */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {([['open', 'Open', '#059669', '#d1fae5'], ['on_hold', 'On Hold', '#ca8a04', '#fefce8'], ['filled', 'Filled', '#2563eb', '#eff6ff'], ['closed', 'Closed', '#64748b', '#f1f5f9']] as const).map(([k, l, col, bg]) => {
          const count = reqs.filter(r => r.status === k).length;
          return count > 0 ? (
            <div key={k} onClick={() => setStatusFilter(statusFilter === k ? '' : k)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 14px', borderRadius: '20px', border: `1px solid ${col}30`, background: bg, cursor: 'pointer' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: col }}>{count}</span>
              <span style={{ fontSize: '12px', color: col, fontWeight: '500' }}>{l}</span>
            </div>
          ) : null;
        })}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: '16px' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '200px', borderRadius: '12px' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '80px 20px',
          background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0',
        }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>💼</div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
            {search ? `No jobs matching "${search}"` : 'No requirements yet'}
          </h3>
          <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '24px', maxWidth: '320px', margin: '0 auto 24px' }}>
            Add your first client requirement to start sourcing candidates
          </p>
          <button onClick={openCreate} style={{
            padding: '10px 24px', background: '#1e40af', color: 'white',
            border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
          }}>
            + Add Requirement
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: '16px' }}>
          {filtered.map((req: any) => (
            <JobCard key={req.id} req={req} onEdit={openEdit} onDelete={handleDelete} counts={stageCounts?.[req.id]} />
          ))}
        </div>
      )}

      {/* ── CLIENT REQUIREMENT FORM ─────────────────────────────────────── */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editId ? 'Edit Client Requirement' : 'New Client Requirement'}
        subtitle="Fill in the requirement details for this job opening"
        size="xl"
        footer={modalFooter}
      >
        {error && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {/* ── Section 1: Job Details ─────────────────────────────────────── */}
        <SectionDivider label="Job Details" />
        <FormRow cols={2}>
          <FormField label="Job Title" required>
            <input style={inputStyle} placeholder="e.g. Senior Python Developer"
              value={form.title} onChange={f('title')} />
          </FormField>
          <FormField label="Client / Company Name">
            <input style={inputStyle} placeholder="e.g. Infosys, TCS, Startup Inc."
              value={form.client_name} onChange={f('client_name')} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Industry">
            <select style={inputStyle} value={form.industry} onChange={f('industry')}>
              <option value="">Select Industry</option>
              {['IT/Software', 'BFSI', 'Healthcare', 'Manufacturing', 'Retail', 'E-commerce', 'Consulting', 'Other'].map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority">
            <select style={inputStyle} value={form.priority} onChange={f('priority')}>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </FormField>
        </FormRow>

        {/* ── Section 2: Work & Contract ─────────────────────────────────── */}
        <SectionDivider label="Work & Contract" />
        <FormRow cols={4}>
          <FormField label="Employment Type" required>
            <select style={inputStyle} value={form.employment_type} onChange={f('employment_type')}>
              <option value="contract">Contract</option>
              <option value="fulltime">Full-time</option>
              <option value="c2h">Contract to Hire</option>
              <option value="fte">FTE</option>
              <option value="part_time">Part-time</option>
            </select>
          </FormField>
          <FormField label="Work Mode">
            <select style={inputStyle} value={form.work_mode} onChange={f('work_mode')}>
              <option value="onsite">Onsite</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </FormField>
          <FormField label="Shift Type">
            <select style={inputStyle} value={form.shift_type} onChange={f('shift_type')}>
              <option value="day">Day</option>
              <option value="night">Night</option>
              <option value="rotational">Rotational</option>
              <option value="flexible">Flexible</option>
            </select>
          </FormField>
          <FormField label="No. of Positions">
            <input type="number" style={inputStyle} min={1} max={500}
              value={form.positions_count} onChange={fNum('positions_count')} />
          </FormField>
        </FormRow>

        {/* ── Section 3: Location & Timeline ─────────────────────────────── */}
        <SectionDivider label="Location & Timeline" />
        <FormRow cols={4}>
          <FormField label="Location">
            <input style={inputStyle} placeholder="e.g. Bengaluru, Remote"
              value={form.location} onChange={f('location')} />
          </FormField>
          <FormField label="Expected Start Date">
            <input type="date" style={inputStyle}
              value={form.expected_start_date} onChange={f('expected_start_date')} />
          </FormField>
          <FormField label="Deadline / Close By">
            <input type="date" style={inputStyle}
              value={form.deadline} onChange={f('deadline')} />
          </FormField>
          <FormField label="SLA Hours" hint="Fill-by SLA in hours">
            <input type="number" style={inputStyle} min={1} placeholder="e.g. 72"
              value={form.sla_hours} onChange={fNum('sla_hours')} />
          </FormField>
        </FormRow>

        {/* ── Section 4: Experience & Education ──────────────────────────── */}
        <SectionDivider label="Experience & Education" />
        <FormRow cols={4}>
          <FormField label="Min Experience (yrs)">
            <input type="number" style={inputStyle} min={0} max={40}
              value={form.experience_min} onChange={fNum('experience_min')} />
          </FormField>
          <FormField label="Max Experience (yrs)">
            <input type="number" style={inputStyle} min={0} max={40}
              value={form.experience_max} onChange={fNum('experience_max')} />
          </FormField>
          <FormField label="Notice Period Max (days)">
            <input type="number" style={inputStyle} min={0} placeholder="60"
              value={form.notice_period_max} onChange={fNum('notice_period_max')} />
          </FormField>
          <FormField label="Education Required">
            <select style={inputStyle} value={form.education_required} onChange={f('education_required')}>
              <option value="">Any</option>
              {['Graduate', 'Post Graduate', 'B.Tech/B.E.', 'M.Tech/M.E.', 'MBA', 'CA/CMA', 'PhD'].map(e => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </FormField>
        </FormRow>

        {/* ── Section 5: Budget / Billing ─────────────────────────────────── */}
        <SectionDivider label="Budget / Billing" />
        <FormRow cols={3}>
          <FormField label="Min Budget (Annual Rs.)">
            <input type="number" style={inputStyle} min={0} placeholder="e.g. 800000"
              value={form.budget_min} onChange={fNum('budget_min')} />
          </FormField>
          <FormField label="Max Budget (Annual Rs.)">
            <input type="number" style={inputStyle} min={0} placeholder="e.g. 1500000"
              value={form.budget_max} onChange={fNum('budget_max')} />
          </FormField>
          <FormField label="Bill Rate (Rs./month) — contract roles">
            <input type="number" style={inputStyle} min={0} placeholder="e.g. 120000"
              value={form.bill_rate} onChange={fNum('bill_rate')} />
          </FormField>
        </FormRow>

        {/* ── Section 6: Required Skills ──────────────────────────────────── */}
        <SectionDivider label="Required Skills" />
        <FormField label="">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '28px' }}>
            {form.skills_required.map(s => (
              <span key={s} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '3px 10px', background: '#eff6ff', color: '#2563eb',
                borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                border: '1px solid #bfdbfe',
              }}>
                {s}
                <span onClick={() => removeSkill(s)} style={{ cursor: 'pointer', color: '#93c5fd', fontWeight: '700', fontSize: '14px', lineHeight: 1 }}>×</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input style={{ ...inputStyle, flex: 1 }}
              placeholder="Type skill and press Enter or pick below..."
              value={skillInput}
              onChange={e => setSkillInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill(skillInput))} />
            <button onClick={() => addSkill(skillInput)} style={{
              padding: '9px 16px', background: '#eff6ff', color: '#2563eb',
              border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
            }}>Add</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px', maxHeight: '120px', overflowY: 'auto' }}>
            {SKILLS_LIST.map(s => (
              <button key={s} onClick={() => addSkill(s)}
                disabled={form.skills_required.includes(s)}
                style={{
                  padding: '3px 9px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                  background: form.skills_required.includes(s) ? '#dcfce7' : '#f8fafc',
                  color: form.skills_required.includes(s) ? '#16a34a' : '#64748b',
                  border: `1px solid ${form.skills_required.includes(s) ? '#bbf7d0' : '#e2e8f0'}`,
                  fontWeight: '500',
                }}>{s}</button>
            ))}
          </div>
        </FormField>

        {/* ── Section 7: Job Description / Notes ─────────────────────────── */}
        <SectionDivider label="Job Description / Notes" />
        <FormField label="">
          <textarea
            style={{ ...inputStyle, minHeight: '120px', resize: 'vertical', lineHeight: '1.6' }}
            placeholder="Describe responsibilities, required experience, company culture, interview process..."
            value={form.description}
            onChange={f('description')}
          />
        </FormField>
      </Modal>
    </div>
  );
}

export default function RequisitionsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>}>
      <RequisitionsPageInner />
    </Suspense>
  );
}
