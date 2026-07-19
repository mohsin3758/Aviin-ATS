'use client';
import { useState, useEffect, CSSProperties } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  User, Mail, Phone, Building2, MapPin, Briefcase, Shield,
  Lock, Eye, EyeOff, CheckCircle, XCircle, Loader2, Save,
  Star, Award, Calendar, Clock, Settings, ChevronRight,
  Camera, Edit2, Key, Bell, Palette
} from 'lucide-react';
import Link from 'next/link';

const ROLE_COLORS: Record<string,string> = {
  admin: '#8b5cf6', super_admin: '#ef4444', lead_recruiter: '#3b82f6',
  recruiter: '#10b981', delivery: '#06b6d4', kae: '#f59e0b',
  kae_manager: '#f97316', viewer: '#64748b'
};
const ROLE_LABELS: Record<string,string> = {
  admin: 'Admin', super_admin: 'Super Admin', lead_recruiter: 'Lead Recruiter',
  recruiter: 'Recruiter', delivery: 'Delivery', kae: 'KAE',
  kae_manager: 'KAE Manager', viewer: 'Viewer'
};

export default function ProfilePage() {
  const { data: me, refetch } = useFetch<any>('/users/me');
  const { data: mailAccounts } = useFetch<any[]>('/user-mail/accounts');

  const [tab, setTab] = useState<'profile'|'security'|'notifications'>('profile');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name:'', phone:'', department:'', designation:'', location:'' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);

  // Password change
  const [pwForm, setPwForm] = useState({ current:'', next:'', confirm:'' });
  const [showPw, setShowPw] = useState({ current:false, next:false, confirm:false });
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    if (me) {
      setForm({
        full_name: me.full_name || '',
        phone: me.phone || '',
        department: me.department || '',
        designation: me.designation || '',
        location: me.location || ''
      });
    }
  }, [me]);

  const showToast = (msg: string, ok=true) => {
    setToast(msg); setToastOk(ok);
    setTimeout(() => setToast(''), 3500);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/users/me', { method:'PUT', body: JSON.stringify(form) });
      showToast('Profile updated successfully!');
      setEditing(false);
      refetch();
    } catch (e: any) {
      showToast('Update failed: ' + e.message, false);
    } finally { setSaving(false); }
  };

  const handlePasswordChange = async () => {
    if (pwForm.next !== pwForm.confirm) {
      showToast('New passwords do not match', false); return;
    }
    if (pwForm.next.length < 8) {
      showToast('Password must be at least 8 characters', false); return;
    }
    setChangingPw(true);
    try {
      await apiFetch('/auth/change-password', {
        method:'POST',
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next })
      });
      showToast('Password changed successfully!');
      setPwForm({ current:'', next:'', confirm:'' });
    } catch (e: any) {
      showToast('Failed: ' + e.message, false);
    } finally { setChangingPw(false); }
  };

  const INP: CSSProperties = {
    width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0',
    borderRadius:'8px', fontSize:'13px', outline:'none',
    color:'#1e293b', boxSizing:'border-box', background:'white'
  };
  const INP_DIS: CSSProperties = { ...INP, background:'#f8fafc', color:'#94a3b8', cursor:'not-allowed' };

  const roleColor = ROLE_COLORS[me?.role] || '#64748b';
  const roleLabel = ROLE_LABELS[me?.role] || me?.role || 'User';
  const initials = (me?.full_name || 'U').split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase();
  const defaultMailAcc = (mailAccounts || []).find((a:any) => a.is_default);

  return (
    <div style={{ maxWidth:'820px', margin:'0 auto', padding:'28px 24px' }}>
      {toast && (
        <div style={{position:'fixed',top:'80px',right:'24px',zIndex:9999,
          background:toastOk?'#1e293b':'#dc2626',color:'white',
          padding:'10px 18px',borderRadius:'10px',fontSize:'13px',
          display:'flex',alignItems:'center',gap:'8px',
          boxShadow:'0 8px 30px rgba(0,0,0,0.25)'}}>
          {toastOk?<CheckCircle size={14} color="#22c55e"/>:<XCircle size={14} color="#fca5a5}"/>}
          {toast}
        </div>
      )}

      {/* Profile hero */}
      <div style={{background:'linear-gradient(135deg,#0f172a,#1e40af)',borderRadius:'16px',
        padding:'28px 32px',marginBottom:'20px',display:'flex',alignItems:'center',gap:'20px',
        position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:'-20px',right:'-20px',width:'150px',height:'150px',
          borderRadius:'50%',background:'rgba(255,255,255,0.04)'}}/>
        <div style={{position:'absolute',bottom:'-30px',right:'80px',width:'100px',height:'100px',
          borderRadius:'50%',background:'rgba(255,255,255,0.03)'}}/>

        {/* Avatar */}
        <div style={{position:'relative',flexShrink:0}}>
          <div style={{width:'72px',height:'72px',borderRadius:'50%',
            background:'linear-gradient(135deg,'+roleColor+','+roleColor+'80)',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:'24px',fontWeight:'800',color:'white',
            border:'3px solid rgba(255,255,255,0.3)',boxShadow:'0 4px 16px rgba(0,0,0,0.3)'}}>
            {initials}
          </div>
        </div>

        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:'22px',fontWeight:'800',color:'white',marginBottom:'4px'}}>
            {me?.full_name || 'Loading...'}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
            <span style={{fontSize:'12px',padding:'3px 10px',borderRadius:'20px',fontWeight:'700',
              background:roleColor+'30',color:'white',border:'1px solid '+roleColor+'60'}}>
              {roleLabel}
            </span>
            <span style={{fontSize:'12px',color:'rgba(255,255,255,0.6)'}}>
              {me?.email}
            </span>
            {me?.designation && (
              <span style={{fontSize:'12px',color:'rgba(255,255,255,0.5)'}}>{me.designation}</span>
            )}
          </div>
          {defaultMailAcc && (
            <div style={{marginTop:'8px',display:'flex',alignItems:'center',gap:'6px'}}>
              <Mail size={11} color="rgba(255,255,255,0.5)"/>
              <span style={{fontSize:'11px',color:'rgba(255,255,255,0.5)'}}>
                Sends from: {defaultMailAcc.email}
              </span>
              <span style={{fontSize:'10px',padding:'1px 6px',borderRadius:'8px',
                background:'rgba(34,197,94,0.2)',color:'#86efac',fontWeight:'600'}}>
                Default
              </span>
            </div>
          )}
          {!defaultMailAcc && (
            <div style={{marginTop:'8px',display:'flex',alignItems:'center',gap:'6px'}}>
              <Mail size={11} color="rgba(255,165,0,0.7)"/>
              <Link href="/settings/mail-accounts"
                style={{fontSize:'11px',color:'rgba(255,165,0,0.9)',textDecoration:'none'}}>
                + Configure your email account to send from your own address
              </Link>
            </div>
          )}
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:'8px',flexShrink:0}}>
          <Link href="/settings/mail-accounts"
            style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',
              background:'rgba(255,255,255,0.1)',color:'white',borderRadius:'8px',
              fontSize:'12px',fontWeight:'600',textDecoration:'none',border:'1px solid rgba(255,255,255,0.15)'}}>
            <Mail size={13}/> Email Accounts
          </Link>
          <Link href="/conversations"
            style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',
              background:'rgba(255,255,255,0.1)',color:'white',borderRadius:'8px',
              fontSize:'12px',fontWeight:'600',textDecoration:'none',border:'1px solid rgba(255,255,255,0.15)'}}>
            <Edit2 size={13}/> Open Mailbox
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'4px',background:'#f8fafc',borderRadius:'10px',
        padding:'4px',marginBottom:'20px',border:'1px solid #e2e8f0'}}>
        {([
          ['profile','👤 My Profile'],
          ['security','🔐 Security'],
          ['notifications','🔔 Notifications'],
        ] as [string,string][]).map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key as any)}
            style={{flex:1,padding:'8px 16px',borderRadius:'8px',border:'none',
              background:tab===key?'white':'transparent',cursor:'pointer',
              fontSize:'13px',fontWeight:tab===key?'700':'500',
              color:tab===key?'#1e293b':'#64748b',
              boxShadow:tab===key?'0 1px 4px rgba(0,0,0,0.08)':'none'}}>
            {label}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {tab==='profile' && (
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'18px 24px',borderBottom:'1px solid #e2e8f0',
            display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:'15px',fontWeight:'800',color:'#0f172a'}}>Personal Information</div>
              <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>Your name, contact, and job details</div>
            </div>
            {!editing ? (
              <button onClick={()=>setEditing(true)}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',
                  border:'1.5px solid #e2e8f0',borderRadius:'8px',background:'white',
                  color:'#374151',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
                <Edit2 size={13}/> Edit Profile
              </button>
            ) : (
              <div style={{display:'flex',gap:'8px'}}>
                <button onClick={()=>{setEditing(false);if(me)setForm({full_name:me.full_name||'',phone:me.phone||'',department:me.department||'',designation:me.designation||'',location:me.location||'',});}}
                  style={{padding:'8px 14px',border:'1px solid #e2e8f0',borderRadius:'8px',
                    background:'white',color:'#64748b',fontSize:'13px',cursor:'pointer'}}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',
                    background:saving?'#94a3b8':'#1e40af',color:'white',border:'none',
                    borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:saving?'not-allowed':'pointer'}}>
                  {saving?<Loader2 size={13} className="animate-spin"/>:<Save size={13}/>}
                  {saving?'Saving...':'Save Changes'}
                </button>
              </div>
            )}
          </div>

          <div style={{padding:'24px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <User size={12} style={{display:'inline',marginRight:'4px'}}/>Full Name
              </label>
              {editing ? (
                <input value={form.full_name} onChange={e=>setForm(p=>({...p,full_name:e.target.value}))} style={INP}/>
              ) : (
                <div style={{...INP_DIS,display:'flex',alignItems:'center'}}>{me?.full_name || '—'}</div>
              )}
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <Mail size={12} style={{display:'inline',marginRight:'4px'}}/>Email Address
              </label>
              <div style={{...INP_DIS,display:'flex',alignItems:'center'}}>
                {me?.email}
                <span style={{marginLeft:'auto',fontSize:'10px',color:'#94a3b8'}}>Read-only</span>
              </div>
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <Phone size={12} style={{display:'inline',marginRight:'4px'}}/>Phone Number
              </label>
              {editing ? (
                <input value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))}
                  placeholder="+91 9876543210" style={INP}/>
              ) : (
                <div style={{...INP_DIS}}>{me?.phone || '—'}</div>
              )}
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <Shield size={12} style={{display:'inline',marginRight:'4px'}}/>Role
              </label>
              <div style={{...INP_DIS,display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{padding:'2px 8px',borderRadius:'10px',fontSize:'11px',fontWeight:'700',
                  background:roleColor+'15',color:roleColor}}>{roleLabel}</span>
                {me?.role_name && <span style={{fontSize:'11px',color:'#94a3b8'}}>{me.role_name}</span>}
              </div>
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <Briefcase size={12} style={{display:'inline',marginRight:'4px'}}/>Designation
              </label>
              {editing ? (
                <input value={form.designation} onChange={e=>setForm(p=>({...p,designation:e.target.value}))}
                  placeholder="e.g. Senior Recruiter" style={INP}/>
              ) : (
                <div style={{...INP_DIS}}>{me?.designation || '—'}</div>
              )}
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <Building2 size={12} style={{display:'inline',marginRight:'4px'}}/>Department
              </label>
              {editing ? (
                <input value={form.department} onChange={e=>setForm(p=>({...p,department:e.target.value}))}
                  placeholder="e.g. Talent Acquisition" style={INP}/>
              ) : (
                <div style={{...INP_DIS}}>{me?.department || '—'}</div>
              )}
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <MapPin size={12} style={{display:'inline',marginRight:'4px'}}/>Location
              </label>
              {editing ? (
                <input value={form.location} onChange={e=>setForm(p=>({...p,location:e.target.value}))}
                  placeholder="e.g. Bangalore" style={INP}/>
              ) : (
                <div style={{...INP_DIS}}>{me?.location || '—'}</div>
              )}
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
                <Clock size={12} style={{display:'inline',marginRight:'4px'}}/>Weekly Capacity
              </label>
              <div style={{...INP_DIS}}>{me?.capacity_weekly || 40} hours/week</div>
            </div>
          </div>

          {/* Email Accounts summary */}
          <div style={{margin:'0 24px 24px',padding:'14px 18px',background:'#f8fafc',
            borderRadius:'10px',border:'1px solid #e2e8f0'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px'}}>
              <div style={{fontSize:'13px',fontWeight:'700',color:'#0f172a',display:'flex',alignItems:'center',gap:'6px'}}>
                <Mail size={14} color="#1e40af"/> My Email Accounts
              </div>
              <Link href="/settings/mail-accounts"
                style={{fontSize:'12px',color:'#1e40af',textDecoration:'none',fontWeight:'600',
                  display:'flex',alignItems:'center',gap:'4px'}}>
                Manage <ChevronRight size={12}/>
              </Link>
            </div>
            {!mailAccounts?.length ? (
              <div style={{fontSize:'12px',color:'#94a3b8',display:'flex',alignItems:'center',gap:'8px'}}>
                <span>No email accounts configured.</span>
                <Link href="/settings/mail-accounts"
                  style={{color:'#1e40af',textDecoration:'none',fontWeight:'600'}}>
                  + Add Gmail, Outlook, or Hostinger →
                </Link>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                {mailAccounts.map((acc:any)=>(
                  <div key={acc.id} style={{display:'flex',alignItems:'center',gap:'10px',
                    padding:'8px 12px',background:'white',borderRadius:'8px',
                    border:'1px solid '+(acc.is_default?'#bfdbfe':'#e2e8f0')}}>
                    <div style={{width:'28px',height:'28px',borderRadius:'6px',
                      background:'#eff6ff',display:'flex',alignItems:'center',
                      justifyContent:'center',fontSize:'11px',fontWeight:'800',color:'#1e40af',flexShrink:0}}>
                      {acc.provider[0].toUpperCase()}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:'12px',fontWeight:'600',color:'#1e293b'}}>{acc.email}</div>
                      <div style={{fontSize:'10px',color:'#94a3b8'}}>{acc.smtp_host} · {acc.provider}</div>
                    </div>
                    {acc.is_default && (
                      <span style={{fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'8px',
                        background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe'}}>DEFAULT</span>
                    )}
                    {acc.verified && <CheckCircle size={14} color="#22c55e"/>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div style={{margin:'0 24px 24px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px'}}>
            {[
              ['/conversations','💬','Open Mailbox','Compose & read emails'],
              ['/settings/mail-accounts','✉️','Email Accounts','Configure SMTP/IMAP'],
              ['/security','🔐','Security','2FA & password'],
            ].map(([href,icon,title,desc])=>(
              <Link key={href as string} href={href as string}
                style={{display:'flex',alignItems:'center',gap:'10px',padding:'12px 14px',
                  background:'#f8fafc',borderRadius:'10px',border:'1px solid #e2e8f0',
                  textDecoration:'none',transition:'border-color 0.15s'}}>
                <span style={{fontSize:'18px'}}>{icon}</span>
                <div>
                  <div style={{fontSize:'12px',fontWeight:'700',color:'#1e293b'}}>{title}</div>
                  <div style={{fontSize:'11px',color:'#64748b'}}>{desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Security tab */}
      {tab==='security' && (
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'18px 24px',borderBottom:'1px solid #e2e8f0'}}>
            <div style={{fontSize:'15px',fontWeight:'800',color:'#0f172a'}}>Security Settings</div>
            <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>Manage your password and account security</div>
          </div>
          <div style={{padding:'24px',maxWidth:'460px'}}>
            <div style={{fontSize:'14px',fontWeight:'700',color:'#1e293b',marginBottom:'16px',
              display:'flex',alignItems:'center',gap:'7px'}}>
              <Key size={15} color="#1e40af"/> Change Password
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              {(['current','next','confirm'] as const).map((key)=>{
                const labels = {current:'Current Password',next:'New Password',confirm:'Confirm New Password'};
                return (
                  <div key={key}>
                    <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>
                      {labels[key]}
                    </label>
                    <div style={{position:'relative'}}>
                      <input
                        type={showPw[key]?'text':'password'}
                        value={pwForm[key]}
                        onChange={e=>setPwForm(p=>({...p,[key]:e.target.value}))}
                        placeholder={key==='current'?'Enter current password':key==='next'?'Min. 8 characters':'Repeat new password'}
                        style={{...INP,paddingRight:'38px'}}/>
                      <button onClick={()=>setShowPw(p=>({...p,[key]:!p[key]}))}
                        style={{position:'absolute',right:'10px',top:'50%',transform:'translateY(-50%)',
                          background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}>
                        {showPw[key]?<EyeOff size={14}/>:<Eye size={14}/>}
                      </button>
                    </div>
                  </div>
                );
              })}
              {pwForm.next && pwForm.confirm && pwForm.next !== pwForm.confirm && (
                <div style={{fontSize:'12px',color:'#dc2626',display:'flex',alignItems:'center',gap:'5px'}}>
                  <XCircle size={12}/> Passwords do not match
                </div>
              )}
              {pwForm.next && pwForm.next.length < 8 && (
                <div style={{fontSize:'12px',color:'#d97706',display:'flex',alignItems:'center',gap:'5px'}}>
                  ⚠ Password must be at least 8 characters
                </div>
              )}
              <button onClick={handlePasswordChange}
                disabled={changingPw||!pwForm.current||!pwForm.next||pwForm.next!==pwForm.confirm||pwForm.next.length<8}
                style={{display:'flex',alignItems:'center',gap:'7px',padding:'10px 20px',
                  background:(changingPw||!pwForm.current||!pwForm.next||pwForm.next!==pwForm.confirm||pwForm.next.length<8)?'#94a3b8':'#1e40af',
                  color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',
                  cursor:'pointer',width:'fit-content',marginTop:'4px'}}>
                {changingPw?<Loader2 size={13} className="animate-spin"/>:<Lock size={13}/>}
                {changingPw?'Changing...':'Change Password'}
              </button>
            </div>

            <div style={{marginTop:'24px',padding:'14px 16px',background:'#fef9c3',
              border:'1px solid #fde68a',borderRadius:'10px',fontSize:'12px',color:'#92400e'}}>
              <div style={{fontWeight:'700',marginBottom:'4px'}}>Security Tips</div>
              <ul style={{margin:0,paddingLeft:'16px',lineHeight:'1.8'}}>
                <li>Use a unique password not used elsewhere</li>
                <li>Include uppercase, lowercase, numbers and symbols</li>
                <li>Enable 2FA for extra protection → <Link href="/security" style={{color:'#d97706'}}>Security settings</Link></li>
                <li>For Gmail/Outlook, use App Passwords in email accounts</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Notifications tab */}
      {tab==='notifications' && (
        <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'18px 24px',borderBottom:'1px solid #e2e8f0'}}>
            <div style={{fontSize:'15px',fontWeight:'800',color:'#0f172a'}}>Notification Preferences</div>
            <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>Choose what alerts you receive</div>
          </div>
          <div style={{padding:'24px'}}>
            {[
              ['Stage Changes','When a candidate moves to a new pipeline stage',true],
              ['Interview Scheduled','When an interview is booked for your candidate',true],
              ['Offer Updates','Offer sent, accepted, or rejected',true],
              ['Email Replies','When a candidate replies to your email',true],
              ['WhatsApp Messages','Inbound WhatsApp messages from candidates',false],
              ['New Candidate Added','When a candidate is added to your requisitions',false],
              ['SLA Alerts','When you are approaching SLA deadlines',true],
              ['AI Insights','Weekly AI-powered hiring insights',false],
            ].map(([label,desc,defaultOn]:any)=>(
              <div key={label} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'12px 0',borderBottom:'1px solid #f1f5f9'}}>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#1e293b'}}>{label}</div>
                  <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>{desc}</div>
                </div>
                <label style={{position:'relative',display:'inline-block',width:'40px',height:'22px',cursor:'pointer'}}>
                  <input type="checkbox" defaultChecked={defaultOn} style={{opacity:0,width:0,height:0}}
                    onChange={()=>{}}/>
                  <span style={{position:'absolute',cursor:'pointer',top:0,left:0,right:0,bottom:0,
                    background:defaultOn?'#1e40af':'#e2e8f0',borderRadius:'11px',transition:'0.3s'}}>
                    <span style={{position:'absolute',height:'16px',width:'16px',left:defaultOn?'21px':'3px',
                      bottom:'3px',background:'white',borderRadius:'50%',transition:'0.3s',
                      boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
                  </span>
                </label>
              </div>
            ))}
            <div style={{marginTop:'16px',display:'flex',gap:'10px'}}>
              <button style={{padding:'9px 20px',background:'#1e40af',color:'white',border:'none',
                borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
                Save Preferences
              </button>
              <div style={{fontSize:'12px',color:'#94a3b8',alignSelf:'center'}}>
                Changes apply immediately
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .animate-spin{animation:spin 1s linear infinite}
      `}</style>
    </div>
  );
}
