'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Calendar, Video, Phone, MapPin, Clock, Mail, MessageCircle, Bell, Plus, CheckCircle } from 'lucide-react';

const MODE_ICONS:Record<string,any> = { video: Video, phone: Phone, in_person: MapPin };
const MODE_COLORS:Record<string,string> = { video:'#3b82f6', phone:'#22c55e', in_person:'#f59e0b' };

function ScheduleModal({ onClose, onScheduled }:any) {
  const { data: appsData } = useFetch<any>('/applications?limit=100');
  const [form, setForm] = useState({
    application_id:'', scheduled_at:'', duration_mins:60,
    mode:'video', meeting_link:'', notes:'', send_whatsapp:true
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any>(null);
  const apps:any[] = Array.isArray(appsData) ? appsData : (appsData?.items || []);

  const save = async () => {
    if (!form.application_id || !form.scheduled_at) return;
    setSaving(true);
    try {
      const r = await apiFetch('/auto-interview/schedule', { method:'POST', body: JSON.stringify(form) });
      setResult(r);
      onScheduled?.();
    } catch(e:any) {
      alert('Error: ' + (e?.message || 'Failed'));
    } finally { setSaving(false); }
  };

  const inp = (label:string, el:any) => (
    <div style={{marginBottom:'12px'}}>
      <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>{label}</label>
      {el}
    </div>
  );
  const iStyle = {width:'100%',border:'1px solid #e2e8f0',borderRadius:'7px',padding:'8px 10px',fontSize:'13px',outline:'none',boxSizing:'border-box' as const};

  return (
    <div style={{position:'fixed',inset:0,zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)'}}>
      <div style={{background:'white',borderRadius:'16px',width:'500px',padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'20px'}}>
          <h2 style={{fontSize:'16px',fontWeight:'800',color:'#0f172a',margin:0}}>Schedule Interview</h2>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#94a3b8'}}>×</button>
        </div>
        {result ? (
          <div style={{textAlign:'center',padding:'20px'}}>
            <CheckCircle size={40} color="#22c55e" style={{marginBottom:'12px'}}/>
            <div style={{fontWeight:'700',fontSize:'15px',color:'#0f172a',marginBottom:'6px'}}>Interview Scheduled!</div>
            <div style={{fontSize:'13px',color:'#64748b',marginBottom:'16px'}}>{result.candidate} · {result.whatsapp_queued ? 'WhatsApp sent ✓' : 'No WhatsApp'}</div>
            <button onClick={onClose} style={{padding:'8px 20px',background:'#0f172a',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>Done</button>
          </div>
        ) : (
          <>
            {inp('Candidate / Application', <select value={form.application_id} onChange={e=>setForm(f=>({...f,application_id:e.target.value}))} style={iStyle}><option value="">Select candidate...</option>{apps.filter((a:any)=>a.stage==='screened'||a.stage==='submitted').map((a:any)=>(<option key={a.id} value={a.id}>{a.candidate_name} — {a.stage}</option>))}</select>)}
            {inp('Date & Time', <input type="datetime-local" value={form.scheduled_at} onChange={e=>setForm(f=>({...f,scheduled_at:e.target.value}))} style={iStyle}/>)}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
              {inp('Duration', <select value={form.duration_mins} onChange={e=>setForm(f=>({...f,duration_mins:Number(e.target.value)}))} style={iStyle}>{[30,45,60,90,120].map(d=><option key={d} value={d}>{d} mins</option>)}</select>)}
              {inp('Mode', <select value={form.mode} onChange={e=>setForm(f=>({...f,mode:e.target.value}))} style={iStyle}><option value="video">Video</option><option value="phone">Phone</option><option value="in_person">In Person</option></select>)}
            </div>
            {inp('Meeting Link (optional)', <input value={form.meeting_link} onChange={e=>setForm(f=>({...f,meeting_link:e.target.value}))} placeholder="https://meet.google.com/..." style={iStyle}/>)}
            {inp('Notes', <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} style={{...iStyle,resize:'vertical' as const}}/>)}
            <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#475569',marginBottom:'16px',cursor:'pointer'}}>
              <input type="checkbox" checked={form.send_whatsapp} onChange={e=>setForm(f=>({...f,send_whatsapp:e.target.checked}))}/>
              Send WhatsApp notification to candidate
            </label>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              <button onClick={onClose} style={{padding:'8px 16px',background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Cancel</button>
              <button onClick={save} disabled={saving||!form.application_id||!form.scheduled_at} style={{padding:'8px 20px',background:'#0f172a',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600',opacity:saving?0.6:1}}>{saving?'Scheduling...':'Schedule Interview'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function InterviewsPage() {
  const { data: interviews, loading, mutate } = useFetch<any[]>('/auto-interview/list');
  const [showModal, setShowModal] = useState(false);
  const [reminding, setReminding] = useState<string|null>(null);
  const [toast, setToast] = useState('');

  const showT = (m:string) => { setToast(m); setTimeout(()=>setToast(''),3000); };

  const sendReminder = async (id:string) => {
    setReminding(id);
    try {
      await apiFetch(`/auto-interview/send-reminder/${id}`, { method:'POST' });
      showT('WhatsApp reminder sent!');
    } catch { showT('Failed to send reminder'); }
    setReminding(null);
  };

  const list:any[] = Array.isArray(interviews) ? interviews : [];
  const upcoming = list.filter(i=>i.hours_until>0).sort((a,b)=>a.hours_until-b.hours_until);
  const past = list.filter(i=>i.hours_until<=0);

  const modeColor = (m:string) => MODE_COLORS[m] || '#64748b';

  return (
    <div className="anim-fade-up" style={{display:'flex',flexDirection:'column',gap:'20px'}}>
      {toast&&<div style={{position:'fixed',top:'80px',right:'24px',zIndex:1000,background:'#0f172a',color:'white',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'600'}}>✓ {toast}</div>}
      {showModal&&<ScheduleModal onClose={()=>setShowModal(false)} onScheduled={()=>{mutate?.();setShowModal(false);}}/>}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'800',color:'#0f172a',marginBottom:'2px'}}>Interview Engine</h1>
          <p style={{fontSize:'13px',color:'#64748b'}}>{upcoming.length} upcoming · {past.length} completed · Auto WhatsApp + ICS calendar</p>
        </div>
        <button onClick={()=>setShowModal(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 18px',background:'#0f172a',color:'white',border:'none',borderRadius:'9px',cursor:'pointer',fontSize:'13px',fontWeight:'700'}}>
          <Plus size={14}/> Schedule Interview
        </button>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
        {[{l:'Total',v:list.length,c:'#3b82f6'},{l:'Upcoming',v:upcoming.length,c:'#22c55e'},{l:'Today',v:list.filter(i=>i.hours_until>0&&i.hours_until<24).length,c:'#d97706'},{l:'Completed',v:past.length,c:'#8b5cf6'}].map(({l,v,c})=>(
          <div key={l} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'16px'}}>
            <div style={{fontSize:'24px',fontWeight:'800',color:'#0f172a'}}>{v}</div>
            <div style={{fontSize:'11px',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.06em',marginTop:'2px'}}>{l}</div>
            <div style={{height:'2px',background:c,borderRadius:'1px',width:'50%',marginTop:'8px'}}/>
          </div>))}
      </div>

      {/* Interview list */}
      {loading?<div style={{textAlign:'center',padding:'48px',color:'#94a3b8'}}>Loading interviews...</div>:
      list.length===0?<div style={{textAlign:'center',padding:'48px',color:'#94a3b8',fontSize:'14px'}}>No interviews scheduled yet. Click "Schedule Interview" to add one.</div>:(
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
              {['CANDIDATE','JOB','DATE & TIME','MODE','STATUS','ACTIONS'].map(h=>(
                <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',color:'#64748b',letterSpacing:'0.06em'}}>{h}</th>))}
            </tr></thead>
            <tbody>
              {list.map((iv:any)=>{
                const isUpcoming = iv.hours_until > 0;
                const ModeIcon = MODE_ICONS[iv.mode] || Video;
                return (
                  <tr key={iv.id} style={{borderBottom:'1px solid #f1f5f9'}}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8fafc'}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='white'}>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>{iv.candidate}</div>
                      <div style={{fontSize:'11px',color:'#94a3b8'}}>{iv.email}</div>
                    </td>
                    <td style={{padding:'12px 14px',fontSize:'13px',color:'#475569'}}>{iv.job_title||'—'}</td>
                    <td style={{padding:'12px 14px'}}>
                      {iv.scheduled_at ? (
                        <div>
                          <div style={{fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>
                            {new Date(iv.scheduled_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}
                          </div>
                          <div style={{fontSize:'11px',color:'#64748b'}}>
                            {new Date(iv.scheduled_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
                            {isUpcoming&&<span style={{marginLeft:'6px',color:'#22c55e',fontWeight:'600'}}>{iv.hours_until<24?`in ${Math.round(iv.hours_until)}h`:''}</span>}
                          </div>
                        </div>
                      ):'—'}
                    </td>
                    <td style={{padding:'12px 14px'}}>
                      <span style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',fontWeight:'600',color:modeColor(iv.mode)}}>
                        <ModeIcon size={12}/> {iv.mode?.replace('_',' ')||'—'}
                      </span>
                    </td>
                    <td style={{padding:'12px 14px'}}>
                      <span style={{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',
                        background:isUpcoming?'#eff6ff':'#f1f5f9',color:isUpcoming?'#2563eb':'#64748b'}}>
                        {isUpcoming?'Upcoming':'Done'}
                      </span>
                    </td>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{display:'flex',gap:'5px'}}>
                        {iv.email&&<button onClick={()=>window.open(`mailto:${iv.email}`,'_blank')} title="Email" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Mail size={12} color="#3b82f6"/></button>}
                        {iv.phone&&<button onClick={()=>window.open(`https://wa.me/91${iv.phone.replace(/\D/g,'')}`,'_blank')} title="WhatsApp" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><MessageCircle size={12} color="#22c55e"/></button>}
                        {isUpcoming&&iv.phone&&<button onClick={()=>sendReminder(iv.id)} disabled={reminding===iv.id} title="Send reminder" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',opacity:reminding===iv.id?0.5:1}}><Bell size={12} color="#f59e0b"/></button>}
                        {iv.scheduled_at&&<button onClick={()=>{
                        const dt=new Date(iv.scheduled_at);
                        const end=new Date(dt.getTime()+(iv.duration_mins||60)*60000);
                        const fmt=(d)=>d.toISOString().replace(/[-:]/g,'').slice(0,15)+'Z';
                        const title=encodeURIComponent('Interview: '+(iv.candidate||'')+' - '+(iv.job_title||'Position'));
                        window.open('https://calendar.google.com/calendar/render?action=TEMPLATE&text='+title+'&dates='+fmt(dt)+'/'+fmt(end),'_blank');
                      }} title="Add to Google Calendar" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'800',color:'#4285F4'}}>G</button>}
                        {iv.scheduled_at&&<button onClick={()=>{
                        const dt=new Date(iv.scheduled_at);
                        const end=new Date(dt.getTime()+(iv.duration_mins||60)*60000);
                        const fmt2=(d:Date)=>d.toISOString().replace(/[-:.]/g,'').slice(0,15)+'Z';
                        const title2=encodeURIComponent('Interview: '+(iv.candidate||'')+' - '+(iv.job_title||'Position'));
                        const loc=iv.meeting_link?encodeURIComponent(iv.meeting_link):'';
                        window.open('https://outlook.office.com/calendar/action/compose?rru=addevent&startdt='+fmt2(dt)+'&enddt='+fmt2(end)+'&subject='+title2+'&location='+loc,'_blank');
                      }} title="Add to Outlook Calendar" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:'800',color:'#0078d4'}}>OL</button>}
                        {iv.calendar_id&&<a href={"/api/calendar/"+(iv.calendar_id||"")+"/download"} target="_blank" title="Download .ics" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',fontSize:'10px',fontWeight:'800',color:'#64748b'}}>📅</a>}
                    {iv.meeting_link&&<button onClick={()=>window.open(iv.meeting_link,'_blank')} title="Join meeting" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Video size={12} color="#8b5cf6"/></button>}
                      </div>
                    </td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
