'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { FileText, CheckCircle, XCircle, Clock, Plus, Copy, ExternalLink, Send, Sparkles } from 'lucide-react';

const STATUS_BADGE:Record<string,{color:string,bg:string,label:string}> = {
  issued:   {color:'#2563eb',bg:'#eff6ff',label:'Issued'},
  accepted: {color:'#16a34a',bg:'#f0fdf4',label:'Accepted'},
  declined: {color:'#dc2626',bg:'#fef2f2',label:'Declined'},
  draft:    {color:'#64748b',bg:'#f1f5f9',label:'Draft'},
  pending_approval:{color:'#d97706',bg:'#fffbeb',label:'Pending Approval'},
  approved: {color:'#0891b2',bg:'#ecfeff',label:'Approved'},
};

function OfferModal({ onClose, onCreated }:any) {
  const { data: appsData } = useFetch<any>('/applications?limit=200');
  const [form, setForm] = useState({ application_id:'', ctc_offered:'', joining_date:'', currency:'INR', generate_letter:true });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const apps:any[] = Array.isArray(appsData) ? appsData : (appsData?.items || []);
  const eligibleApps = apps.filter((a:any) => ['submitted','interview'].includes(a.stage));

  const save = async () => {
    if (!form.application_id || !form.ctc_offered || !form.joining_date) return;
    setSaving(true);
    try {
      const r = await apiFetch('/auto-offer/generate', { method:'POST', body: JSON.stringify({...form, ctc_offered: Number(form.ctc_offered)}) });
      setResult(r);
      onCreated?.();
    } catch(e:any) { alert('Error: ' + (e?.message||'Failed')); }
    finally { setSaving(false); }
  };

  const copy = () => { navigator.clipboard.writeText(result?.offer_letter||''); setCopied(true); setTimeout(()=>setCopied(false),2000); };
  const iStyle = {width:'100%',border:'1px solid #e2e8f0',borderRadius:'7px',padding:'8px 10px',fontSize:'13px',outline:'none',boxSizing:'border-box' as const};

  return (
    <div style={{position:'fixed',inset:0,zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)'}}>
      <div style={{background:'white',borderRadius:'16px',width:'620px',maxHeight:'85vh',overflow:'auto',padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'20px'}}>
          <div>
            <h2 style={{fontSize:'16px',fontWeight:'800',color:'#0f172a',margin:0}}>Generate Offer Letter</h2>
            <p style={{fontSize:'12px',color:'#8b5cf6',margin:'2px 0 0'}}>Powered by Ollama Qwen2.5 · Zero external tokens</p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#94a3b8'}}>×</button>
        </div>
        {result ? (
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px'}}>
              <CheckCircle size={20} color="#22c55e"/>
              <span style={{fontWeight:'700',color:'#0f172a'}}>Offer generated for {result.candidate}</span>
              <span style={{fontSize:'11px',color:'#8b5cf6',background:'#f5f3ff',padding:'2px 7px',borderRadius:'20px'}}>{result.generated_by}</span>
            </div>
            <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'16px',marginBottom:'14px',fontFamily:'serif',fontSize:'13px',lineHeight:'1.8',whiteSpace:'pre-wrap',maxHeight:'320px',overflowY:'auto'}}>
              {result.offer_letter}
            </div>
            <div style={{display:'flex',gap:'8px'}}>
              <button onClick={copy} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 16px',background:copied?'#22c55e':'#0f172a',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
                <Copy size={13}/> {copied?'Copied!':'Copy Letter'}
              </button>
              <button onClick={onClose} style={{padding:'8px 16px',background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{marginBottom:'12px'}}>
              <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>Candidate (Submitted / Interview stage)</label>
              <select value={form.application_id} onChange={e=>setForm(f=>({...f,application_id:e.target.value}))} style={iStyle}>
                <option value="">Select candidate...</option>
                {eligibleApps.map((a:any)=>(<option key={a.id} value={a.id}>{a.candidate_name} — {a.stage}</option>))}
              </select>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'12px'}}>
              <div>
                <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>CTC Offered (₹/year)</label>
                <input type="number" value={form.ctc_offered} onChange={e=>setForm(f=>({...f,ctc_offered:e.target.value}))} placeholder="800000" style={iStyle}/>
              </div>
              <div>
                <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>Joining Date</label>
                <input type="date" value={form.joining_date} onChange={e=>setForm(f=>({...f,joining_date:e.target.value}))} style={iStyle}/>
              </div>
              <div>
                <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>Currency</label>
                <select value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))} style={iStyle}>
                  <option value="INR">INR ₹</option><option value="USD">USD $</option>
                </select>
              </div>
            </div>
            <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#475569',marginBottom:'16px',cursor:'pointer'}}>
              <input type="checkbox" checked={form.generate_letter} onChange={e=>setForm(f=>({...f,generate_letter:e.target.checked}))}/>
              <Sparkles size={13} color="#8b5cf6"/> Generate personalized letter with Ollama AI (else use template)
            </label>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              <button onClick={onClose} style={{padding:'8px 16px',background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Cancel</button>
              <button onClick={save} disabled={saving||!form.application_id||!form.ctc_offered||!form.joining_date}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 20px',background:'#7c3aed',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600',opacity:saving?0.6:1}}>
                <Sparkles size={13}/>{saving?'Generating (AI)...':'Generate Offer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function OffersPage() {
  const { data: offers, loading, mutate } = useFetch<any[]>('/auto-offer/list');
  const [showModal, setShowModal] = useState(false);
  const [genLink, setGenLink] = useState<Record<string,string>>({});
  const [toast, setToast] = useState('');

  const showT = (m:string) => { setToast(m); setTimeout(()=>setToast(''),3000); };

  const generateLink = async (appId:string) => {
    try {
      const r = await apiFetch(`/self-schedule/generate/${appId}`, { method:'POST' });
      setGenLink(prev=>({...prev,[appId]:r.link}));
      await navigator.clipboard.writeText(`https://ats.aviinjobs.com${r.link}`);
      showT('Self-scheduling link copied to clipboard!');
    } catch { showT('Failed to generate link'); }
  };

  const list:any[] = Array.isArray(offers) ? offers : [];
  const stats = {
    total: list.length,
    issued: list.filter(o=>o.status==='issued').length,
    accepted: list.filter(o=>o.status==='accepted').length,
    declined: list.filter(o=>o.status==='declined').length,
  };

  return (
    <div className="anim-fade-up" style={{display:'flex',flexDirection:'column',gap:'20px'}}>
      {toast&&<div style={{position:'fixed',top:'80px',right:'24px',zIndex:1000,background:'#0f172a',color:'white',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'600'}}>✓ {toast}</div>}
      {showModal&&<OfferModal onClose={()=>setShowModal(false)} onCreated={()=>{mutate?.();setShowModal(false);}}/>}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'800',color:'#0f172a',marginBottom:'2px'}}>Offer Engine</h1>
          <p style={{fontSize:'13px',color:'#64748b'}}>AI-generated offer letters · Self-scheduling links · Zero external tokens</p>
        </div>
        <button onClick={()=>setShowModal(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 18px',background:'#7c3aed',color:'white',border:'none',borderRadius:'9px',cursor:'pointer',fontSize:'13px',fontWeight:'700'}}>
          <Sparkles size={14}/> Generate Offer
        </button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
        {[{l:'Total',v:stats.total,c:'#3b82f6'},{l:'Issued',v:stats.issued,c:'#0891b2'},{l:'Accepted',v:stats.accepted,c:'#22c55e'},{l:'Declined',v:stats.declined,c:'#ef4444'}].map(({l,v,c})=>(
          <div key={l} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'16px'}}>
            <div style={{fontSize:'24px',fontWeight:'800',color:'#0f172a'}}>{v}</div>
            <div style={{fontSize:'11px',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.06em',marginTop:'2px'}}>{l}</div>
            <div style={{height:'2px',background:c,borderRadius:'1px',width:'50%',marginTop:'8px'}}/>
          </div>))}
      </div>

      {loading?<div style={{textAlign:'center',padding:'48px',color:'#94a3b8'}}>Loading offers...</div>:
      list.length===0?<div style={{textAlign:'center',padding:'48px',color:'#94a3b8',fontSize:'14px'}}>No offers yet. Click "Generate Offer" to create one with Ollama AI.</div>:(
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
              {['CANDIDATE','JOB','CTC OFFERED','JOINING','STATUS','ACTIONS'].map(h=>(
                <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',color:'#64748b',letterSpacing:'0.06em'}}>{h}</th>))}
            </tr></thead>
            <tbody>
              {list.map((offer:any)=>{
                const badge = STATUS_BADGE[offer.status]||STATUS_BADGE.draft;
                const ctcL = offer.ctc_offered >= 100000 ? `₹${(offer.ctc_offered/100000).toFixed(1)}L` : `₹${offer.ctc_offered}`;
                const link = genLink[offer.application_id];
                return (
                  <tr key={offer.id} style={{borderBottom:'1px solid #f1f5f9'}}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8fafc'}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='white'}>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>{offer.candidate}</div>
                      <div style={{fontSize:'11px',color:'#94a3b8'}}>{offer.email}</div>
                    </td>
                    <td style={{padding:'12px 14px',fontSize:'13px',color:'#475569'}}>{offer.job_title||'—'}</td>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{fontWeight:'700',fontSize:'13px',color:'#16a34a'}}>{ctcL}</div>
                      {offer.expected_ctc>0&&<div style={{fontSize:'10px',color:'#94a3b8'}}>asked ₹{(offer.expected_ctc/100000).toFixed(1)}L</div>}
                    </td>
                    <td style={{padding:'12px 14px',fontSize:'13px',color:'#475569'}}>{offer.joining_date||'—'}</td>
                    <td style={{padding:'12px 14px'}}>
                      <span style={{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',background:badge.bg,color:badge.color}}>{badge.label}</span>
                    </td>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{display:'flex',gap:'5px',flexWrap:'wrap'}}>
                        <button onClick={()=>generateLink(offer.application_id)} title="Generate self-scheduling link" style={{display:'flex',alignItems:'center',gap:'4px',padding:'4px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'11px',color:'#8b5cf6',fontWeight:'600'}}>
                          <ExternalLink size={11}/> Schedule Link
                        </button>
                        {link&&<span style={{fontSize:'10px',color:'#22c55e',padding:'4px 6px',background:'#f0fdf4',borderRadius:'4px'}}>Copied!</span>}
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
