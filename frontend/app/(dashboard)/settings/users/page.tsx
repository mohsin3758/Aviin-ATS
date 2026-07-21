'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormRow, FormActions } from '@/components/ui/Modal';
import { Plus, Search, Shield, UserCheck, UserX, Edit, Trash2, Key } from 'lucide-react';

const ROLES_LIST = [
  'admin','recruiter','senior_recruiter','lead_recruiter','recruitment_manager','talent_acquisition','technical_recruiter',
  'kae','kam','account_director','sales_executive','sales_manager','finance_manager','hr_manager','compliance_officer','ceo','cto',
];
const DEPT_LIST = ['Delivery','Account Management','Sales','Finance','HR','Technology','Leadership','Operations','IT'];
const EMPTY_USER = { email:'', full_name:'', role:'recruiter', department:'Delivery', designation:'', phone:'', employee_id:'', location:'', capacity_weekly:40, password:'Welcome@2026', reporting_to:'' };

const ROLE_COLOR:Record<string,string> = {
  admin:'badge-red', ceo:'badge-purple', recruitment_manager:'badge-blue',
  recruiter:'badge-green', kae:'badge-teal', finance_manager:'badge-amber',
};

const getColor=(name:string)=>['#1e40af','#7c3aed','#0f766e','#92400e','#be185d','#0369a1'][(name?.charCodeAt(0)||0)%6];
const getInitials=(name:string)=>(name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

export default function UsersPage() {
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string|null>(null);
  const [form, setForm] = useState({...EMPTY_USER});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const { data: users, loading, refetch } = useFetch<any[]>('/users');
  const { data: roles } = useFetch<any[]>('/roles');

  const filtered = (users||[]).filter(u =>
    (!search || u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())) &&
    (!deptFilter || u.department === deptFilter)
  );

  const openCreate = () => { setForm({...EMPTY_USER}); setEditId(null); setError(''); setShowModal(true); };
  const openEdit = (u:any) => {
    setForm({ email:u.email||'', full_name:u.full_name||'', role:u.role||'recruiter', department:u.department||'Delivery',
      designation:u.designation||'', phone:u.phone||'', employee_id:u.employee_id||'',
      location:u.location||'', capacity_weekly:u.capacity_weekly||40, password:'', reporting_to:u.reporting_to||'' });
    setEditId(u.id); setError(''); setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.email || !form.full_name) { setError('Email and name are required'); return; }
    setSaving(true); setError('');
    try {
      const payload:any = {...form}; if (!payload.password) delete payload.password;
      payload.reporting_to = payload.reporting_to || null;
      if (editId) await apiFetch(`/users/${editId}`, { method:'PUT', body:JSON.stringify(payload) });
      else await apiFetch('/users', { method:'POST', body:JSON.stringify(payload) });
      setShowModal(false); refetch();
    } catch(e:any) { setError(e.message||'Failed to save'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (u:any) => {
    try { await apiFetch(`/users/${u.id}/${u.is_active!==false?'deactivate':'activate'}`, {method:'PATCH'}); refetch(); } catch {}
  };

  const inputStyle = { width:'100%', border:'1px solid #e2e8f0', borderRadius:'8px', padding:'9px 12px', fontSize:'13px', outline:'none', color:'#1e293b', background:'white', boxSizing:'border-box' as const };
  const depts = [...new Set((users||[]).map(u=>u.department).filter(Boolean))];

  return (
    <div className="anim-fade-up space-y-6">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
        <div>
          <h1 style={{ fontSize:'20px', fontWeight:'700', color:'#0f172a' }}>Users & Roles</h1>
          <p style={{ fontSize:'13px', color:'#64748b', marginTop:'2px' }}>{(users||[]).filter(u=>u.is_active!==false).length} active users · {(roles||[]).length} roles</p>
        </div>
        <button onClick={openCreate} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'9px 18px', background:'#1e40af', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
          <Plus size={14} /> Invite User
        </button>
      </div>

      <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:'260px', maxWidth:'360px' }}>
          <Search size={13} style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
          <input placeholder="Search by name or email..." value={search} onChange={e=>setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft:'30px', borderRadius:'20px', background:'#f8fafc' }} />
        </div>
        <div style={{ display:'flex', gap:'5px', flexWrap:'wrap' }}>
          {['All',...depts].map(d=>(
            <button key={d} onClick={()=>setDeptFilter(d==='All'?'':d)}
              style={{ padding:'5px 12px', borderRadius:'20px', fontSize:'11px', fontWeight:'600', cursor:'pointer', background:(d==='All'&&!deptFilter)||deptFilter===d?'#1e40af':'white', color:(d==='All'&&!deptFilter)||deptFilter===d?'white':'#374151', border:`1px solid ${(d==='All'&&!deptFilter)||deptFilter===d?'#1e40af':'#e2e8f0'}` }}>{d}</button>
          ))}
        </div>
      </div>

      <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e2e8f0', overflow:'hidden' }}>
        {loading ? <div style={{ padding:'32px' }}>{[1,2,3].map(i=><div key={i} className="skeleton" style={{ height:'52px', borderRadius:'8px', marginBottom:'8px' }} />)}</div> :
        filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'60px' }}>
            <div style={{ fontSize:'48px', marginBottom:'12px' }}>👤</div>
            <h3 style={{ fontSize:'16px', fontWeight:'600', color:'#374151', marginBottom:'6px' }}>No users found</h3>
            <button onClick={openCreate} style={{ padding:'9px 20px', background:'#1e40af', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', marginTop:'12px' }}>+ Invite User</button>
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr style={{ background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
              {['User','Role','Department','Employee ID','Status','Actions'].map(h=>(
                <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:'11px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.05em', color:'#64748b' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((u:any)=>(
                <tr key={u.id} style={{ borderBottom:'1px solid #f1f5f9', transition:'background 0.1s' }}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8faff'}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=''}>
                  <td style={{ padding:'12px 16px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                      <div style={{ width:'36px', height:'36px', borderRadius:'50%', background:getColor(u.full_name), display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', fontWeight:'700', color:'white', flexShrink:0 }}>{getInitials(u.full_name)}</div>
                      <div><div style={{ fontSize:'13px', fontWeight:'600', color:'#0f172a' }}>{u.full_name}</div><div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'1px' }}>{u.email}</div></div>
                    </div>
                  </td>
                  <td style={{ padding:'12px 16px' }}>
                    <span className={`badge ${ROLE_COLOR[u.role]||'badge-gray'}`} style={{ fontSize:'11px', textTransform:'capitalize' }}>{u.role_name||u.role}</span>
                    {u.role_level && <span style={{ fontSize:'10px', color:'#94a3b8', marginLeft:'6px' }}>L{u.role_level}</span>}
                  </td>
                  <td style={{ padding:'12px 16px', fontSize:'12px', color:'#475569' }}>{u.department||'—'}</td>
                  <td style={{ padding:'12px 16px', fontSize:'12px', color:'#475569', fontFamily:'monospace' }}>{u.employee_id||'—'}</td>
                  <td style={{ padding:'12px 16px' }}>
                    <span style={{ fontSize:'11px', fontWeight:'600', padding:'3px 10px', borderRadius:'12px', background:u.is_active!==false?'#d1fae5':'#f1f5f9', color:u.is_active!==false?'#059669':'#64748b' }}>
                      {u.is_active!==false?'Active':'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding:'12px 16px' }}>
                    <div style={{ display:'flex', gap:'4px' }}>
                      <button onClick={()=>openEdit(u)} style={{ width:'28px', height:'28px', borderRadius:'6px', border:'1px solid #e2e8f0', background:'#f8fafc', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', padding:0 }}><Edit size={12} style={{ color:'#64748b' }} /></button>
                      <button onClick={()=>toggleActive(u)} title={u.is_active!==false?'Deactivate':'Activate'} style={{ width:'28px', height:'28px', borderRadius:'6px', border:`1px solid ${u.is_active!==false?'#fee2e2':'#d1fae5'}`, background:u.is_active!==false?'#fef2f2':'#f0fdf4', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', padding:0 }}>
                        {u.is_active!==false?<UserX size={12} style={{ color:'#ef4444' }} />:<UserCheck size={12} style={{ color:'#059669' }} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite/Edit Modal */}
      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editId?'Edit User':'Invite New User'} subtitle={editId?'Update user profile and role':'Send an invitation to join your team'} size="lg">
        {error && <div style={{ marginBottom:'16px', padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', fontSize:'13px', color:'#dc2626' }}>⚠️ {error}</div>}
        <FormRow>
          <FormField label="Full Name" required><input style={inputStyle} placeholder="e.g. Rahul Sharma" value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))} /></FormField>
          <FormField label="Email" required><input type="email" style={inputStyle} placeholder="rahul@aviinjobs.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></FormField>
        </FormRow>
        <FormRow>
          <FormField label="Role" required>
            <select style={{ ...inputStyle }} value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
              {ROLES_LIST.map(r=><option key={r} value={r}>{r.replace(/_/g,' ').replace(/\w/g,c=>c.toUpperCase())}</option>)}
            </select>
          </FormField>
          <FormField label="Department">
            <select style={{ ...inputStyle }} value={form.department} onChange={e=>setForm(f=>({...f,department:e.target.value}))}>
              {DEPT_LIST.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="Designation"><input style={inputStyle} placeholder="e.g. Senior IT Recruiter" value={form.designation} onChange={e=>setForm(f=>({...f,designation:e.target.value}))} /></FormField>
          <FormField label="Employee ID"><input style={inputStyle} placeholder="e.g. EMP-001" value={form.employee_id} onChange={e=>setForm(f=>({...f,employee_id:e.target.value}))} /></FormField>
        </FormRow>
        <FormRow>
          <FormField label="Phone"><input style={inputStyle} placeholder="+91 9876543210" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} /></FormField>
          <FormField label="Location"><input style={inputStyle} placeholder="e.g. Bengaluru" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} /></FormField>
        </FormRow>
        <FormRow>
          <FormField label="Weekly Capacity (hrs)" hint="Default: 40 hours/week"><input type="number" style={inputStyle} min={0} max={60} value={form.capacity_weekly} onChange={e=>setForm(f=>({...f,capacity_weekly:+e.target.value}))} /></FormField>
          <FormField label="Reports To" hint="Notified when this user's candidates clear NDA e-sign">
            <select style={{ ...inputStyle }} value={form.reporting_to} onChange={e=>setForm(f=>({...f,reporting_to:e.target.value}))}>
              <option value="">— None —</option>
              {(users||[]).filter((u:any)=>u.id!==editId).map((u:any)=><option key={u.id} value={u.id}>{u.full_name} ({u.role_name||u.role})</option>)}
            </select>
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label={editId?'New Password (leave blank to keep)':'Password'} hint="Min 8 chars, include uppercase + number"><input type="password" style={inputStyle} placeholder={editId?'Leave blank to keep current':'Welcome@2026'} value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} /></FormField>
        </FormRow>
        <FormActions onClose={()=>setShowModal(false)} onSubmit={handleSave} loading={saving} submitLabel={editId?'Update User':'Send Invitation'} />
      </Modal>
    </div>
  );
}
