'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormActions } from '@/components/ui/Modal';
import { Mail, Send, Clock, CheckCheck, XCircle, Folder, Tag,
         Settings, Phone, Plus, Layers, ChevronRight, Sparkles } from 'lucide-react';

export default function ConversationsPage() {
  const [activeSection, setActiveSection] = useState('all');
  const [showCompose, setShowCompose] = useState(false);
  const [composeForm, setComposeForm] = useState({ to:'', subject:'', body:'' });
  const [sending, setSending] = useState(false);
  const { data: emailTmpls } = useFetch<any[]>('/email-templates');
  const { data: smsLog } = useFetch<any[]>('/sms/log');
  const { data: nurture } = useFetch<any[]>('/nurture');
  const { data: notifs } = useFetch<any[]>('/notifications?limit=20');

  const inputStyle = { width:'100%', border:'1px solid #e2e8f0', borderRadius:'8px', padding:'9px 12px', fontSize:'13px', outline:'none', color:'#1e293b', background:'white', boxSizing:'border-box' as const };

  const SECTIONS = [
    { group:'EMAIL', items:[
      { key:'all', icon:'📥', label:'All Emails' },
      { key:'opened', icon:'✅', label:'Opened / Replied' },
      { key:'failed', icon:'❌', label:'Failed Emails' },
      { key:'scheduled', icon:'🕐', label:'Scheduled Emails' },
      { key:'folders', icon:'📁', label:'Folders & Labels' },
    ]},
    { group:'EMAIL SETTINGS', items:[
      { key:'templates', icon:'📝', label:'Email Templates' },
      { key:'standard', icon:'📋', label:'Standard Templates' },
    ]},
    { group:'SEQUENCES', items:[
      { key:'sequences', icon:'🔄', label:'Nurture Sequences' },
    ]},
    { group:'NOTIFICATIONS', items:[
      { key:'notifications', icon:'🔔', label:'In-App Notifications' },
    ]},
    { group:'PHONE', items:[
      { key:'calls', icon:'📞', label:'Call / SMS Logs' },
    ]},
  ];

  return (
    <div style={{ display:'flex', height:'calc(100vh - 80px)', gap:'0' }}>
      {/* Left sidebar */}
      <div style={{ width:'220px', flexShrink:0, borderRight:'1px solid #e2e8f0', paddingRight:'8px', overflowY:'auto' }}>
        <button onClick={()=>setShowCompose(true)} style={{ display:'flex', alignItems:'center', gap:'6px', width:'100%', padding:'9px 14px', background:'#1e40af', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', marginBottom:'16px' }}>
          <Mail size={14} /> Compose Email
        </button>
        {SECTIONS.map(section=>(
          <div key={section.group} style={{ marginBottom:'16px' }}>
            <div style={{ fontSize:'10px', fontWeight:'700', textTransform:'uppercase', letterSpacing:'0.08em', color:'#94a3b8', padding:'4px 8px', marginBottom:'4px' }}>{section.group}</div>
            {section.items.map(item=>(
              <button key={item.key} onClick={()=>setActiveSection(item.key)}
                style={{ display:'flex', alignItems:'center', gap:'8px', width:'100%', padding:'7px 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:activeSection===item.key?'600':'400', background:activeSection===item.key?'#eff6ff':'transparent', color:activeSection===item.key?'#1e40af':'#374151', transition:'all 0.1s', textAlign:'left' }}>
                <span>{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex:1, paddingLeft:'24px', overflowY:'auto' }}>
        {/* All Emails */}
        {(activeSection==='all'||activeSection==='opened'||activeSection==='failed'||activeSection==='scheduled'||activeSection==='folders') && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', textAlign:'center' }}>
            <div style={{ fontSize:'64px', marginBottom:'16px' }}>📧</div>
            <h3 style={{ fontSize:'18px', fontWeight:'700', color:'#1e293b', marginBottom:'8px' }}>All your email in one place</h3>
            <p style={{ fontSize:'13px', color:'#64748b', maxWidth:'320px', marginBottom:'6px' }}>See email conversations on candidate & client profiles</p>
            <p style={{ fontSize:'12px', color:'#94a3b8', marginBottom:'24px' }}>Connect your email account to see sent & received messages here.</p>
            <button style={{ padding:'10px 24px', background:'#1e40af', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', marginBottom:'32px' }}>
              + Connect Email Account
            </button>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'10px', width:'100%', maxWidth:'480px' }}>
              {(emailTmpls||[]).slice(0,4).map((t:any)=>(
                <div key={t.id} style={{ padding:'12px 14px', background:'white', border:'1px solid #e2e8f0', borderRadius:'10px', textAlign:'left' }}>
                  <div style={{ fontSize:'12px', fontWeight:'600', color:'#1e293b' }}>{t.name}</div>
                  <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'2px', textTransform:'capitalize' }}>{t.category}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Email Templates */}
        {activeSection==='templates' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
              <h2 style={{ fontSize:'16px', fontWeight:'700', color:'#0f172a' }}>Email Templates ({(emailTmpls||[]).length})</h2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:'12px' }}>
              {(emailTmpls||[]).map((t:any)=>(
                <div key={t.id} style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'10px', padding:'16px', transition:'all 0.15s' }}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.boxShadow='0 4px 12px rgba(0,0,0,0.06)'}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.boxShadow=''}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                    <span style={{ fontSize:'20px' }}>{'📧'}</span>
                    <div>
                      <div style={{ fontSize:'13px', fontWeight:'600', color:'#0f172a' }}>{t.name}</div>
                      <div style={{ fontSize:'11px', textTransform:'capitalize', color:'#64748b' }}>{t.category?.replace(/_/g,' ')}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:'12px', color:'#64748b', lineHeight:'1.5', marginBottom:'10px', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' as any }}
                    dangerouslySetInnerHTML={{ __html:t.subject }} />
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
                    {(t.variables||[]).slice(0,3).map((v:string)=>(
                      <span key={v} style={{ fontSize:'10px', padding:'2px 7px', borderRadius:'4px', background:'#eff6ff', color:'#1e40af', fontFamily:'monospace' }}>{'{'+v+'}'}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nurture Sequences */}
        {activeSection==='sequences' && (
          <div>
            <h2 style={{ fontSize:'16px', fontWeight:'700', color:'#0f172a', marginBottom:'16px' }}>Nurture Sequences ({(nurture||[]).length})</h2>
            <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              {(nurture||[]).map((n:any)=>(
                <div key={n.id} style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'10px', padding:'16px 20px' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div>
                      <div style={{ fontSize:'14px', fontWeight:'600', color:'#0f172a' }}>{n.name}</div>
                      <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>Trigger: <strong>{n.trigger_event?.replace(/_/g,' ')}</strong> · {(n.steps||[]).length} steps</div>
                    </div>
                    <span style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'10px', background:n.is_active?'#d1fae5':'#f1f5f9', color:n.is_active?'#059669':'#64748b', fontWeight:'600' }}>
                      {n.is_active?'Active':'Paused'}
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:'6px', marginTop:'10px' }}>
                    {(n.steps||[]).map((_:any,i:number)=>(
                      <div key={i} style={{ flex:1, height:'4px', borderRadius:'2px', background:i===0?'#1e40af':i===1?'#7c3aed':'#e2e8f0' }} />
                    ))}
                  </div>
                </div>
              ))}
              {!nurture?.length && <div style={{ textAlign:'center', padding:'40px', color:'#94a3b8' }}>No nurture sequences. <a href="/nurture" style={{ color:'#1e40af' }}>Create one →</a></div>}
            </div>
          </div>
        )}

        {/* Notifications */}
        {activeSection==='notifications' && (
          <div>
            <h2 style={{ fontSize:'16px', fontWeight:'700', color:'#0f172a', marginBottom:'16px' }}>In-App Notifications</h2>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {(notifs||[]).map((n:any)=>(
                <div key={n.id} style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'10px', padding:'12px 16px', display:'flex', alignItems:'flex-start', gap:'12px', opacity:n.is_read?0.6:1 }}>
                  <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:n.is_read?'#cbd5e1':'#1e40af', flexShrink:0, marginTop:'5px' }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:'13px', fontWeight:n.is_read?'400':'600', color:'#0f172a' }}>{n.title}</div>
                    {n.message && <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>{n.message}</div>}
                    <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'4px' }}>{new Date(n.created_at).toLocaleString('en-IN')}</div>
                  </div>
                </div>
              ))}
              {!notifs?.length && <div style={{ textAlign:'center', padding:'40px', color:'#94a3b8' }}>No notifications yet</div>}
            </div>
          </div>
        )}

        {/* SMS/Call Logs */}
        {activeSection==='calls' && (
          <div>
            <h2 style={{ fontSize:'16px', fontWeight:'700', color:'#0f172a', marginBottom:'16px' }}>SMS & Call Logs</h2>
            <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'12px', overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr style={{ background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
                  {['Time','To','Template','Message','Status'].map(h=><th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:'11px', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.05em', color:'#64748b' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(smsLog||[]).map((s:any)=>(
                    <tr key={s.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                      <td style={{ padding:'10px 16px', fontSize:'12px', color:'#64748b' }}>{new Date(s.created_at).toLocaleString('en-IN')}</td>
                      <td style={{ padding:'10px 16px', fontSize:'12px', fontFamily:'monospace', color:'#1e293b' }}>{s.to_phone}</td>
                      <td style={{ padding:'10px 16px' }}><span style={{ fontSize:'11px', padding:'2px 8px', borderRadius:'6px', background:'#f1f5f9', color:'#475569' }}>{s.template||'custom'}</span></td>
                      <td style={{ padding:'10px 16px', fontSize:'12px', color:'#64748b', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.message}</td>
                      <td style={{ padding:'10px 16px' }}><span style={{ fontSize:'11px', padding:'2px 8px', borderRadius:'6px', background:s.status==='sent'?'#d1fae5':s.status==='failed'?'#fee2e2':'#f1f5f9', color:s.status==='sent'?'#059669':s.status==='failed'?'#dc2626':'#475569', fontWeight:'600' }}>{s.status}</span></td>
                    </tr>
                  ))}
                  {!smsLog?.length && <tr><td colSpan={5} style={{ textAlign:'center', padding:'32px', color:'#94a3b8', fontSize:'12px' }}>No SMS/calls logged yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Compose Modal */}
      <Modal open={showCompose} onClose={()=>setShowCompose(false)} title="Compose Email" subtitle="Send an email to a candidate or client" size="md">
        <FormField label="To"><input style={inputStyle} placeholder="recipient@email.com or search by name..." value={composeForm.to} onChange={e=>setComposeForm(f=>({...f,to:e.target.value}))} /></FormField>
        <FormField label="Subject"><input style={inputStyle} placeholder="Email subject..." value={composeForm.subject} onChange={e=>setComposeForm(f=>({...f,subject:e.target.value}))} /></FormField>
        <div style={{ display:'flex', gap:'6px', marginBottom:'12px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'11px', color:'#64748b', padding:'4px 0' }}>Use template:</span>
          {(emailTmpls||[]).slice(0,4).map((t:any)=>(
            <button key={t.id} onClick={()=>setComposeForm(f=>({...f,subject:t.subject,body:t.body_html?.replace(/<[^>]*>/g,'')||''}))}
              style={{ padding:'3px 10px', borderRadius:'6px', border:'1px solid #bfdbfe', background:'#eff6ff', color:'#1e40af', fontSize:'11px', fontWeight:'500', cursor:'pointer' }}>
              {t.name}
            </button>
          ))}
        </div>
        <FormField label="Message">
          <textarea style={{ ...inputStyle, minHeight:'160px', resize:'vertical', lineHeight:'1.6' }} placeholder="Type your message..." value={composeForm.body} onChange={e=>setComposeForm(f=>({...f,body:e.target.value}))} />
        </FormField>
        <div style={{ display:'flex', gap:'10px', justifyContent:'flex-end', marginTop:'16px', paddingTop:'16px', borderTop:'1px solid #f1f5f9' }}>
          <button onClick={()=>setShowCompose(false)} style={{ padding:'9px 20px', borderRadius:'8px', border:'1px solid #e2e8f0', background:'white', fontSize:'13px', fontWeight:'500', color:'#374151', cursor:'pointer' }}>Cancel</button>
          <button onClick={()=>setShowCompose(false)} style={{ padding:'9px 20px', borderRadius:'8px', border:'none', background:'#94a3b8', color:'white', fontSize:'13px', fontWeight:'500', cursor:'pointer' }}>Save Draft</button>
          <button onClick={()=>{alert('Connect email account first to send emails.');setShowCompose(false);}} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'9px 20px', borderRadius:'8px', border:'none', background:'#1e40af', color:'white', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
            <Send size={13} /> Send Email
          </button>
        </div>
      </Modal>
    </div>
  );
}
