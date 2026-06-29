'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Calendar, CheckCircle, Clock, Video, MapPin } from 'lucide-react';

const STAGE_COLORS:Record<string,string> = {
  sourced:'#64748b',screened:'#2563eb',submitted:'#7c3aed',
  interview:'#d97706',offer:'#0891b2',placed:'#16a34a',rejected:'#dc2626'
};
const STAGE_ICONS:Record<string,string> = {
  sourced:'📥',screened:'🔍',submitted:'📋',
  interview:'🎯',offer:'🎉',placed:'✅',rejected:'❌'
};

export default function SelfSchedulePage() {
  const { token } = useParams<{token:string}>();
  const { data, loading, error } = useFetch<any>(token ? `/self-schedule/public/${token}` : null);
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState('video');
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState<any>(null);

  const book = async () => {
    if (!selected) return;
    setBooking(true);
    try {
      const r = await apiFetch(`/self-schedule/book/${token}?slot_datetime=${encodeURIComponent(selected)}&mode=${mode}`, { method:'POST' });
      setBooked(r);
    } catch(e:any) { alert('Booking failed: ' + (e?.message||'Please try again')); }
    setBooking(false);
  };

  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}>
      <div style={{textAlign:'center',color:'#64748b'}}>
        <div style={{fontSize:'32px',marginBottom:'8px'}}>⏳</div>
        <div>Loading your interview details...</div>
      </div>
    </div>
  );

  if (error || !data) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}>
      <div style={{textAlign:'center',maxWidth:'400px',padding:'32px'}}>
        <div style={{fontSize:'48px',marginBottom:'12px'}}>🔗</div>
        <h2 style={{fontWeight:'800',color:'#0f172a',marginBottom:'8px'}}>Link Expired</h2>
        <p style={{color:'#64748b',lineHeight:'1.6'}}>This scheduling link has expired or is invalid. Please contact your recruiter for a new link.</p>
      </div>
    </div>
  );

  const stageColor = STAGE_COLORS[data.current_stage] || '#64748b';
  const stageIcon = STAGE_ICONS[data.current_stage] || '📋';

  return (
    <div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px'}}>
      <div style={{width:'100%',maxWidth:'520px'}}>
        {/* Header */}
        <div style={{background:'#0f172a',borderRadius:'16px',padding:'28px',marginBottom:'20px',color:'white',textAlign:'center'}}>
          <div style={{fontSize:'40px',marginBottom:'8px'}}>A</div>
          <div style={{fontWeight:'800',fontSize:'18px',marginBottom:'4px'}}>AVIIN Jobs</div>
          <div style={{fontSize:'13px',color:'rgba(255,255,255,0.6)'}}>AI Staffing OS</div>
        </div>

        {/* Candidate info */}
        <div style={{background:'white',borderRadius:'14px',padding:'24px',border:'1px solid #e2e8f0',marginBottom:'16px'}}>
          <div style={{textAlign:'center',marginBottom:'20px'}}>
            <div style={{width:'60px',height:'60px',borderRadius:'50%',background:stageColor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'24px',margin:'0 auto 12px'}}>
              {data.candidate_name?.charAt(0)?.toUpperCase()||'?'}
            </div>
            <h1 style={{fontSize:'20px',fontWeight:'800',color:'#0f172a',marginBottom:'4px'}}>Hi, {data.candidate_name}!</h1>
            <p style={{color:'#64748b',fontSize:'14px'}}>Applied for: <strong>{data.job_title || 'Position'}</strong></p>
          </div>
          {/* Status */}
          <div style={{background:'#f8fafc',borderRadius:'10px',padding:'16px',textAlign:'center'}}>
            <div style={{fontSize:'28px',marginBottom:'8px'}}>{stageIcon}</div>
            <div style={{fontWeight:'700',color:stageColor,fontSize:'15px',marginBottom:'4px'}}>{data.stage_label}</div>
            <div style={{fontSize:'12px',color:'#94a3b8'}}>Current application status</div>
          </div>
        </div>

        {/* Self-scheduling */}
        {booked ? (
          <div style={{background:'white',borderRadius:'14px',padding:'32px',border:'1px solid #bbf7d0',textAlign:'center'}}>
            <CheckCircle size={48} color="#22c55e" style={{marginBottom:'12px'}}/>
            <h2 style={{fontWeight:'800',color:'#0f172a',marginBottom:'8px'}}>Interview Booked!</h2>
            <p style={{color:'#64748b',fontSize:'14px',lineHeight:'1.6',marginBottom:'20px'}}>{booked.message}</p>
            <div style={{background:'#f0fdf4',borderRadius:'8px',padding:'12px',fontSize:'13px',color:'#16a34a',fontWeight:'600'}}>
              A calendar invite will be sent to your email shortly.
            </div>
          </div>
        ) : data.current_stage === 'interview' || data.current_stage === 'screened' || data.current_stage === 'submitted' ? (
          <div style={{background:'white',borderRadius:'14px',padding:'24px',border:'1px solid #e2e8f0'}}>
            <h2 style={{fontSize:'16px',fontWeight:'800',color:'#0f172a',marginBottom:'4px'}}>Schedule Your Interview</h2>
            <p style={{fontSize:'13px',color:'#64748b',marginBottom:'20px'}}>Pick a time that works best for you</p>

            {/* Mode selection */}
            <div style={{marginBottom:'16px'}}>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'8px'}}>Interview Mode</label>
              <div style={{display:'flex',gap:'8px'}}>
                {[{v:'video',l:'Video Call',i:'🎥'},{v:'phone',l:'Phone Call',i:'📞'},{v:'in_person',l:'In Person',i:'🏢'}].map(({v,l,i})=>(
                  <button key={v} onClick={()=>setMode(v)}
                    style={{flex:1,padding:'10px',borderRadius:'8px',border:mode===v?'2px solid #0f172a':'1px solid #e2e8f0',background:mode===v?'#0f172a':'white',color:mode===v?'white':'#475569',cursor:'pointer',fontSize:'12px',fontWeight:'600',textAlign:'center'}}>
                    <div style={{fontSize:'18px',marginBottom:'2px'}}>{i}</div>{l}
                  </button>))}
              </div>
            </div>

            {/* Slot selection */}
            <div style={{marginBottom:'20px'}}>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'8px'}}>Available Slots (Next 7 days)</label>
              <div style={{display:'flex',flexDirection:'column',gap:'8px',maxHeight:'280px',overflowY:'auto'}}>
                {(data.available_slots||[]).map((slot:any)=>(
                  <button key={slot.datetime} onClick={()=>setSelected(slot.datetime)}
                    style={{padding:'12px 16px',borderRadius:'8px',border:selected===slot.datetime?'2px solid #0f172a':'1px solid #e2e8f0',background:selected===slot.datetime?'#0f172a':'white',color:selected===slot.datetime?'white':'#475569',cursor:'pointer',fontSize:'13px',fontWeight:'600',textAlign:'left',display:'flex',alignItems:'center',gap:'8px'}}>
                    <Clock size={14}/>{slot.label}
                  </button>))}
              </div>
            </div>

            <button onClick={book} disabled={!selected||booking}
              style={{width:'100%',padding:'13px',background:selected?'#0f172a':'#e2e8f0',color:selected?'white':'#94a3b8',border:'none',borderRadius:'10px',cursor:selected?'pointer':'not-allowed',fontSize:'14px',fontWeight:'700'}}>
              {booking?'Booking...':`Confirm ${selected?new Date(selected).toLocaleString('en-IN',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'your slot'}`}
            </button>
          </div>
        ) : (
          <div style={{background:'white',borderRadius:'14px',padding:'24px',border:'1px solid #e2e8f0',textAlign:'center'}}>
            <div style={{fontSize:'32px',marginBottom:'8px'}}>👋</div>
            <p style={{color:'#64748b',fontSize:'14px',lineHeight:'1.6'}}>
              Your application is being reviewed. Your recruiter will reach out soon for next steps.
            </p>
          </div>
        )}

        <div style={{textAlign:'center',marginTop:'20px',fontSize:'12px',color:'#94a3b8'}}>
          Powered by AVIIN ATS · AI Staffing OS
        </div>
      </div>
    </div>
  );
}
