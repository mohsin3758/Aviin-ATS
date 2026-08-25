'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormRow, FormActions } from '@/components/ui/Modal';
import { Plus, Search, Building2, MapPin, Phone, Mail, Globe,
         Star, Edit, Trash2, Eye, ChevronRight, Briefcase, Users, FileText } from 'lucide-react';

const INDUSTRIES = ['Information Technology','IT Services','IT Consulting','Banking & Finance',
  'Manufacturing','Retail','Healthcare','Pharma','BFSI','Telecom','E-commerce','Consulting','Other'];

const EMPTY = {
  name:'', industry:'', email:'', phone:'', website:'',
  address:'', city:'', state:'', gstin:'', contact_person:'', is_active:true,
};

const AVATAR_COLORS = ['#1e40af','#7c3aed','#0f766e','#92400e','#be185d','#0369a1'];
const getColor = (name:string) => AVATAR_COLORS[(name?.charCodeAt(0)||0) % AVATAR_COLORS.length];
const getInitials = (name:string) => (name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

// REAL GAP FIX (2026-08-12 audit): PUT /clients/{id}/resume-preference
// existed and worked (verified directly via API) but had zero frontend
// caller — the auto-recommendation engine could only ever fall back to
// "most recently used" or the default, never a real intentional client
// preference. This is that missing caller.
function ResumePreferenceRow({ client, onSaved }: { client: any; onSaved: () => void }) {
  const { data: templates } = useFetch<any[]>('/resume-generator/templates');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Local state, not just client.default_resume_template_id directly —
  // `client` is a snapshot captured when the row was clicked, and the
  // parent's refetch() updates the list, not this stale prop, so a
  // controlled <select> bound straight to the prop would visually revert
  // right after a successful save.
  const [value, setValue] = useState(client.default_resume_template_id || '');
  useEffect(() => { setValue(client.default_resume_template_id || ''); }, [client.id]);

  async function save(templateId: string) {
    setValue(templateId);
    setSaving(true); setSaved(false);
    try {
      await apiFetch(`/clients/${client.id}/resume-preference`, {
        method: 'PUT', body: JSON.stringify({ default_resume_template_id: templateId || null }),
      });
      setSaved(true); onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { alert(e?.message || 'Failed to save resume preference'); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', marginBottom: '10px' }}>
        Default Resume Format
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <FileText size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
        <select
          value={value}
          onChange={e => save(e.target.value)}
          disabled={saving}
          style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '7px', padding: '6px 8px', fontSize: '12.5px', outline: 'none', background: 'white' }}
        >
          <option value="">No preference (auto: most recently used, else Full Contact)</option>
          {(templates || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {saved && <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>Saved</span>}
      </div>
      <p style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '6px' }}>
        Drives the Resume Generator's auto-recommendation when submitting a candidate for this client.
      </p>
    </div>
  );
}

// New (KAE -> Client submission feature): the "Client/KAM contact email"
// the Approve & Send flow defaults its "To" from — nothing in this schema
// stored one before this. A client can have more than one contact (e.g. a
// primary KAM + a backup HR contact); exactly one can be marked primary.
function ClientContactsRow({ client }: { client: any }) {
  const { data: contacts, refetch } = useFetch<any[]>(`/clients/${client.id}/contacts`);
  const [form, setForm] = useState<{ contact_name: string; email: string; role_label: string }>({ contact_name: '', email: '', role_label: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const add = async () => {
    if (!form.contact_name.trim() || !form.email.trim()) { setErr('Name and email are required'); return; }
    setSaving(true); setErr('');
    try {
      await apiFetch(`/clients/${client.id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ contact_name: form.contact_name, email: form.email, role_label: form.role_label || null, is_primary: !(contacts && contacts.length) }),
      });
      setForm({ contact_name: '', email: '', role_label: '' });
      refetch();
    } catch (e: any) { setErr(e.message || 'Failed to add contact'); }
    finally { setSaving(false); }
  };

  const setPrimary = async (c: any) => {
    try {
      await apiFetch(`/client-contacts/${c.id}`, {
        method: 'PUT', body: JSON.stringify({ contact_name: c.contact_name, email: c.email, role_label: c.role_label, is_primary: true }),
      });
      refetch();
    } catch (e: any) { setErr(e.message || 'Failed to set primary'); }
  };

  const remove = async (c: any) => {
    if (!confirm(`Remove contact "${c.contact_name}"?`)) return;
    try {
      await apiFetch(`/client-contacts/${c.id}`, { method: 'DELETE' });
      refetch();
    } catch (e: any) { setErr(e.message || 'Failed to remove'); }
  };

  return (
    <div data-testid="client-contacts-row" style={{ padding: '16px', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', marginBottom: '10px' }}>
        Client SPOCs
      </div>
      {(contacts || []).map((c: any) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: c.is_primary ? '#eff6ff' : '#f8fafc', border: `1px solid ${c.is_primary ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>
              {c.contact_name}{c.role_label ? ` · ${c.role_label}` : ''} {c.is_primary && <span style={{ fontSize: 9, fontWeight: 800, color: '#1d4ed8' }}>PRIMARY</span>}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
          </div>
          {!c.is_primary && <button onClick={() => setPrimary(c)} title="Make primary" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#2563eb' }}>Set Primary</button>}
          <button onClick={() => remove(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><Trash2 size={13} /></button>
        </div>
      ))}
      {!contacts?.length && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>No SPOCs yet — add this client's point(s) of contact below. A client can have several SPOCs (e.g. one per role type); the KAE/KAM picks the right one when sending.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <input placeholder="SPOC name" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })}
          style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }} />
        <input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
          style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }} />
        <input placeholder="Role / handles (e.g. KAM, SAP roles) — optional" value={form.role_label} onChange={e => setForm({ ...form, role_label: e.target.value })}
          style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }} />
        {err && <div style={{ color: '#dc2626', fontSize: 11 }}>{err}</div>}
        <button onClick={add} disabled={saving} style={{ padding: '6px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' }}>
          {saving ? 'Adding…' : '+ Add SPOC'}
        </button>
      </div>
      <p style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 8 }}>
        The primary SPOC is the default recipient when a KAE/KAM sends a profile to this client — if there's more than one, they'll be able to pick the right one at send time.
      </p>
    </div>
  );
}

function SidePanel({ client, reqs, onClose, onEdit, onRefetch }: any) {
  // REAL BUG FIX (2026-08-17): reqs is the full tenant-wide requisitions
  // list — was never filtered to this specific client, so every client's
  // drawer showed the same "Open Jobs" count and job cards as every
  // other client's.
  const openReqs = (reqs||[]).filter((r:any)=>r.status==='open' && r.client_id===client.id);
  return (
    <div style={{
      position:'fixed', right:0, top:0, height:'100vh', width:'400px',
      background:'white', borderLeft:'1px solid #e2e8f0',
      boxShadow:'-8px 0 32px rgba(0,0,0,0.12)',
      zIndex:200, display:'flex', flexDirection:'column',
      animation:'slideIn 0.2s ease',
    }}>
      {/* Header */}
      <div style={{ padding:'20px 24px', borderBottom:'1px solid #f1f5f9', background:'linear-gradient(135deg,#1e40af,#3b82f6)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:'48px', height:'48px', borderRadius:'12px', background:'rgba(255,255,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', fontWeight:'700', color:'white' }}>
            {getInitials(client.name)}
          </div>
          <div>
            <div style={{ fontSize:'16px', fontWeight:'700', color:'white' }}>{client.name}</div>
            <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.75)', marginTop:'2px' }}>{client.city && `📍 ${client.city}`}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft:'auto', width:'28px', height:'28px', borderRadius:'8px', border:'none', background:'rgba(255,255,255,0.2)', color:'white', cursor:'pointer', fontSize:'16px', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:'6px', padding:'12px 16px', borderBottom:'1px solid #f1f5f9', flexWrap:'wrap' }}>
        {['📝 Note','📞 Call Log','✅ Tasks','📅 Meeting','⭐ Hotlist'].map(a=>(
          <button key={a} style={{ padding:'5px 10px', border:'1px solid #e2e8f0', borderRadius:'6px', background:'white', fontSize:'11px', fontWeight:'500', color:'#374151', cursor:'pointer' }}>{a}</button>
        ))}
        <button onClick={()=>onEdit(client)} style={{ padding:'5px 10px', border:'1px solid #bfdbfe', borderRadius:'6px', background:'#eff6ff', fontSize:'11px', fontWeight:'600', color:'#1e40af', cursor:'pointer', marginLeft:'auto' }}>✏️ Edit</button>
      </div>

      {/* Details */}
      <div style={{ flex:1, overflowY:'auto' }}>
        <div style={{ padding:'16px', borderBottom:'1px solid #f1f5f9' }}>
          <div style={{ fontSize:'11px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.06em', color:'#94a3b8', marginBottom:'12px' }}>Contact Details</div>
          {[
            [Mail, client.email||'—', 'Email'],
            [Phone, client.phone||'—', 'Phone'],
            [Globe, client.website||'—', 'Website'],
            [MapPin, [client.address,client.city,client.state].filter(Boolean).join(', ')||'—', 'Address'],
            [Users, client.contact_person||'—', 'Contact Person'],
          ].map(([Icon, val, lbl]:any) => (
            <div key={lbl} style={{ display:'flex', gap:'10px', marginBottom:'10px', alignItems:'flex-start' }}>
              <Icon size={13} style={{ color:'#94a3b8', marginTop:'2px', flexShrink:0 }} />
              <div>
                <div style={{ fontSize:'11px', color:'#94a3b8' }}>{lbl}</div>
                <div style={{ fontSize:'13px', color:'#1e293b', fontWeight:'500' }}>{val}</div>
              </div>
            </div>
          ))}
        </div>

        <ResumePreferenceRow client={client} onSaved={onRefetch} />
        <ClientContactsRow client={client} />

        {/* Open Jobs */}
        <div style={{ padding:'16px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' }}>
            <div style={{ fontSize:'11px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.06em', color:'#94a3b8' }}>Open Jobs</div>
            <span style={{ fontSize:'11px', fontWeight:'700', background:'#eff6ff', color:'#1e40af', padding:'2px 8px', borderRadius:'10px' }}>
              {openReqs.length}
            </span>
          </div>
          {openReqs.slice(0,4).map((r:any) => (
            <div key={r.id} style={{ padding:'10px 12px', background:'#f8fafc', borderRadius:'8px', marginBottom:'6px', border:'1px solid #e2e8f0' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:'12px', fontWeight:'600', color:'#1e293b' }}>{r.title}</div>
                  <div style={{ fontSize:'11px', color:'#64748b', marginTop:'2px' }}>📍 {r.location||'—'} · {r.positions_count} pos.</div>
                </div>
                <span style={{ fontSize:'10px', fontWeight:'600', padding:'2px 8px', borderRadius:'10px', background:'#d1fae5', color:'#059669' }}>Open</span>
              </div>
              <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
                {(r.skills_required||[]).slice(0,3).map((s:string)=>(
                  <span key={s} style={{ fontSize:'9px', padding:'2px 6px', borderRadius:'4px', background:'#eff6ff', color:'#2563eb', fontWeight:'500' }}>{s}</span>
                ))}
              </div>
            </div>
          ))}
          {!openReqs.length && (
            <div style={{ textAlign:'center', padding:'20px', color:'#94a3b8', fontSize:'12px' }}>No open jobs for this client</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string|null>(null);
  const [form, setForm] = useState({...EMPTY});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const { data: clients, loading, refetch } = useFetch<any[]>('/clients');
  const { data: reqs } = useFetch<any[]>('/requisitions');

  const filtered = (clients||[]).filter(cl =>
    !search || cl.name?.toLowerCase().includes(search.toLowerCase()) ||
    cl.city?.toLowerCase().includes(search.toLowerCase()) ||
    cl.industry?.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => { setForm({...EMPTY}); setEditId(null); setError(''); setShowModal(true); };
  const openEdit = (cl:any) => {
    setForm({ name:cl.name||'', industry:cl.industry||'', email:cl.email||'',
      phone:cl.phone||'', website:cl.website||'', address:cl.address||'',
      city:cl.city||'', state:cl.state||'', gstin:cl.gstin||'',
      contact_person:cl.contact_person||'', is_active:cl.is_active!==false });
    setEditId(cl.id); setError(''); setShowModal(true); setSelected(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Company name is required'); return; }
    setSaving(true); setError('');
    try {
      if (editId) await apiFetch(`/clients/${editId}`, { method:'PUT', body:JSON.stringify(form) });
      else await apiFetch('/clients', { method:'POST', body:JSON.stringify(form) });
      setShowModal(false); refetch();
    } catch(e:any) { setError(e.message||'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id:string) => {
    if (!confirm('Delete this company?')) return;
    try { await apiFetch(`/clients/${id}`, {method:'DELETE'}); refetch(); setSelected(null); } catch {}
  };

  const inputStyle = { width:'100%', border:'1px solid #e2e8f0', borderRadius:'8px', padding:'9px 12px', fontSize:'13px', outline:'none', color:'#1e293b', background:'white', boxSizing:'border-box' as const };

  return (
    <div className="anim-fade-up">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px', flexWrap:'wrap', gap:'12px' }}>
        <div>
          <h1 style={{ fontSize:'20px', fontWeight:'700', color:'#0f172a' }}>Companies & Clients</h1>
          <p style={{ fontSize:'13px', color:'#64748b', marginTop:'2px' }}>{(clients||[]).length} clients in your CRM</p>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <div style={{ position:'relative' }}>
            <Search size={13} style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
            <input placeholder="Search companies..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{ ...inputStyle, paddingLeft:'30px', width:'220px', borderRadius:'20px', background:'#f8fafc' }} />
          </div>
          <button onClick={openCreate} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'9px 18px', background:'#1e40af', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
            <Plus size={14} /> Add Company
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e2e8f0', overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:'32px' }}>
            {[1,2,3].map(i=><div key={i} className="skeleton" style={{ height:'52px', borderRadius:'8px', marginBottom:'8px' }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'80px 20px' }}>
            <div style={{ fontSize:'56px', marginBottom:'16px' }}>🏢</div>
            <h3 style={{ fontSize:'18px', fontWeight:'600', color:'#374151', marginBottom:'8px' }}>No companies yet</h3>
            <p style={{ fontSize:'13px', color:'#9ca3af', marginBottom:'24px' }}>Add your first client company to start managing accounts</p>
            <button onClick={openCreate} style={{ padding:'10px 24px', background:'#1e40af', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>+ Add Company</button>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
                  {['','Company Name','Industry','Location','Contact','Website','Open Jobs','Status','Actions'].map((h,i)=>(
                    <th key={i} style={{ padding:'10px 16px', textAlign:'left', fontSize:'11px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.05em', color:'#64748b', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((cl:any) => {
                  // REAL BUG FIX (2026-08-17): was counting every open
                  // requisition tenant-wide, not this client's — every
                  // row in the table showed the identical wrong number.
                  const openJobs = (reqs||[]).filter((r:any)=>r.status==='open' && r.client_id===cl.id).length;
                  return (
                    <tr key={cl.id} onClick={()=>setSelected(cl)}
                      style={{ borderBottom:'1px solid #f1f5f9', cursor:'pointer', transition:'background 0.1s' }}
                      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8faff'}
                      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=''}>
                      <td style={{ padding:'12px 16px', width:'40px' }}>
                        <input type="checkbox" onClick={e=>e.stopPropagation()} style={{ accentColor:'#1e40af' }} />
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                          <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:getColor(cl.name), display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', fontWeight:'700', color:'white', flexShrink:0 }}>
                            {getInitials(cl.name)}
                          </div>
                          <div>
                            <div style={{ fontSize:'13px', fontWeight:'600', color:'#1e40af' }}>{cl.name}</div>
                            {cl.gstin && <div style={{ fontSize:'10px', color:'#94a3b8', fontFamily:'monospace' }}>{cl.gstin}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:'12px', color:'#475569' }}>{cl.industry||'—'}</td>
                      <td style={{ padding:'12px 16px' }}>
                        {cl.city ? (
                          <div style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'12px', color:'#475569' }}>
                            <MapPin size={11} />{cl.city}{cl.state?`, ${cl.state}`:''}
                          </div>
                        ) : <span style={{ color:'#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ padding:'12px 16px', fontSize:'12px', color:'#475569' }}>{cl.contact_person||'—'}</td>
                      <td style={{ padding:'12px 16px' }}>
                        {cl.website ? (
                          <a href={`https://${cl.website}`} onClick={e=>e.stopPropagation()} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize:'12px', color:'#1e40af', textDecoration:'none', display:'flex', alignItems:'center', gap:'4px' }}>
                            <Globe size={11} />{cl.website}
                          </a>
                        ) : <span style={{ color:'#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ fontSize:'14px', fontWeight:'700', color:'#059669' }}>{openJobs}</span>
                      </td>
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ fontSize:'11px', fontWeight:'600', padding:'3px 10px', borderRadius:'12px', background:cl.is_active!==false?'#d1fae5':'#f1f5f9', color:cl.is_active!==false?'#059669':'#64748b' }}>
                          {cl.is_active!==false?'Active':'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding:'12px 16px' }} onClick={e=>e.stopPropagation()}>
                        <div style={{ display:'flex', gap:'4px' }}>
                          <button onClick={()=>openEdit(cl)} style={{ width:'28px', height:'28px', borderRadius:'6px', border:'1px solid #e2e8f0', background:'#f8fafc', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', padding:0 }}>
                            <Edit size={12} style={{ color:'#64748b' }} />
                          </button>
                          <button onClick={()=>handleDelete(cl.id)} style={{ width:'28px', height:'28px', borderRadius:'6px', border:'1px solid #fee2e2', background:'#fef2f2', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', padding:0 }}>
                            <Trash2 size={12} style={{ color:'#ef4444' }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Side Panel */}
      {selected && (
        <>
          <div style={{ position:'fixed', inset:0, background:'transparent', zIndex:199 }} onClick={()=>setSelected(null)} />
          <SidePanel client={selected} reqs={reqs} onClose={()=>setSelected(null)} onEdit={openEdit} onRefetch={refetch} />
        </>
      )}

      {/* Add/Edit Modal */}
      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editId?'Edit Company':'Add New Company'} subtitle="Manage client companies and accounts" size="lg">
        {error && <div style={{ marginBottom:'16px', padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', fontSize:'13px', color:'#dc2626' }}>⚠️ {error}</div>}
        <FormRow>
          <FormField label="Company Name" required>
            <input style={inputStyle} placeholder="e.g. Infosys BPM" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          </FormField>
          <FormField label="Industry">
            <select style={{ ...inputStyle }} value={form.industry} onChange={e=>setForm(f=>({...f,industry:e.target.value}))}>
              <option value="">Select industry...</option>
              {INDUSTRIES.map(i=><option key={i} value={i}>{i}</option>)}
            </select>
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="Email">
            <input type="email" style={inputStyle} placeholder="hr@company.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} />
          </FormField>
          <FormField label="Phone">
            <input style={inputStyle} placeholder="+91 9876543210" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="Website">
            <input style={inputStyle} placeholder="e.g. infosys.com" value={form.website} onChange={e=>setForm(f=>({...f,website:e.target.value}))} />
          </FormField>
          <FormField label="Contact Person">
            <input style={inputStyle} placeholder="e.g. Priya Sharma (HR)" value={form.contact_person} onChange={e=>setForm(f=>({...f,contact_person:e.target.value}))} />
          </FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="City">
            <input style={inputStyle} placeholder="Bengaluru" value={form.city} onChange={e=>setForm(f=>({...f,city:e.target.value}))} />
          </FormField>
          <FormField label="State">
            <input style={inputStyle} placeholder="Karnataka" value={form.state} onChange={e=>setForm(f=>({...f,state:e.target.value}))} />
          </FormField>
          <FormField label="GSTIN" hint="15-char GST number">
            <input style={inputStyle} placeholder="29XXXXX1234A1ZU" value={form.gstin} onChange={e=>setForm(f=>({...f,gstin:e.target.value.toUpperCase()}))} />
          </FormField>
        </FormRow>
        <FormField label="Full Address">
          <input style={inputStyle} placeholder="Street, Building, Area..." value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} />
        </FormField>
        <FormActions onClose={()=>setShowModal(false)} onSubmit={handleSave} loading={saving} submitLabel={editId?'Update Company':'Add Company'} />
      </Modal>
    </div>
  );
}
