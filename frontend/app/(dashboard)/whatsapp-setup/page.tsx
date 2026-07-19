'use client';
import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, Smartphone, ExternalLink } from 'lucide-react';

// Use NEXT_PUBLIC_API_URL which is already set to https://ats.aviinjobs.com/api
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

async function wahaGet(path: string) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function wahaPost(path: string) {
  const r = await fetch(API_BASE + path, { method: 'POST', headers: {'Content-Type':'application/json'} });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const STAGE_MSGS = [
  { stage: 'Screened',  color: '#2563eb', msg: 'Hi [Name], your profile has been shortlisted by AVIIN Jobs. Our recruiter will contact you soon.' },
  { stage: 'Interview', color: '#d97706', msg: 'Hi [Name], you have been selected for an interview. Please check your email for details.' },
  { stage: 'Offer',     color: '#0891b2', msg: 'Hi [Name], great news - an offer is being prepared for you. Our team will call you shortly.' },
  { stage: 'Placed',    color: '#16a34a', msg: 'Hi [Name], congratulations on your placement! Wishing you great success in your new role.' },
  { stage: 'Rejected',  color: '#64748b', msg: 'Hi [Name], thank you for your interest. We will keep your profile for future opportunities.' },
];

export default function WhatsAppSetupPage() {
  const [status, setStatus]   = useState<any>(null);
  const [qrData, setQrData]   = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState('');
  const [polling, setPolling] = useState(false);

  const showT = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const checkStatus = async () => {
    try { const r = await wahaGet('/waha/status'); setStatus(r); return r; }
    catch { return null; }
  };

  const startAndGetQR = async () => {
    setLoading(true); setQrData('');
    try {
      await wahaPost('/waha/start');
      showT('Session starting... fetching QR in 8 seconds');
      await new Promise(res => setTimeout(res, 8000));
      const qr = await wahaGet('/waha/qr');
      if (qr.qr && qr.qr.length > 20) {
        setQrData(qr.qr);
        showT('QR ready! Scan with WhatsApp now');
        setPolling(true);
      } else {
        showT('QR not ready yet - WAHA initializing. Try again in 15 seconds.');
      }
    } catch {
      showT('Connection error - please try again');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    checkStatus();
    const iv = setInterval(async () => {
      const s = await checkStatus();
      if (s && s.connected && polling) { setPolling(false); showT('WhatsApp Connected!'); }
    }, 8000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling]);

  const isConnected = !!(status && (status.connected || status.status === 'WORKING'));
  const isScanning  = !!(status && status.status === 'SCAN_QR_CODE');
  const dotColor    = isConnected ? '#22c55e' : isScanning ? '#d97706' : '#dc2626';
  const labelTxt    = isConnected ? 'CONNECTED' : isScanning ? 'WAITING FOR QR SCAN' : (status ? status.status : 'NOT STARTED');

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'24px',maxWidth:'640px'}}>
      {toast && (
        <div style={{position:'fixed',top:'80px',right:'24px',zIndex:1000,background:'#0f172a',color:'white',padding:'12px 20px',borderRadius:'8px',fontSize:'13px',fontWeight:'600',boxShadow:'0 4px 20px rgba(0,0,0,0.3)',maxWidth:'380px'}}>
          {toast}
        </div>
      )}

      <div>
        <h1 style={{fontSize:'20px',fontWeight:'800',color:'#0f172a',marginBottom:'4px'}}>WhatsApp Setup</h1>
        <p style={{fontSize:'13px',color:'#64748b'}}>Connect WhatsApp to auto-send stage notifications to candidates</p>
      </div>

      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'14px',padding:'24px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'14px',marginBottom:'20px'}}>
          <div style={{width:'52px',height:'52px',borderRadius:'12px',background:dotColor+'15',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {isConnected ? <CheckCircle size={28} color="#22c55e"/> : isScanning ? <Smartphone size={28} color="#d97706"/> : <AlertCircle size={28} color="#dc2626"/>}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:'800',fontSize:'17px',color:'#0f172a'}}>
              {isConnected ? 'WhatsApp Connected!' : 'WhatsApp Not Connected'}
            </div>
            <div style={{fontSize:'13px',marginTop:'3px'}}>
              Status: <strong style={{color:dotColor}}>{labelTxt}</strong>
            </div>
          </div>
          <button onClick={checkStatus} title="Refresh" style={{background:'none',border:'1px solid #e2e8f0',borderRadius:'8px',cursor:'pointer',color:'#94a3b8',padding:'8px',display:'flex',alignItems:'center'}}>
            <RefreshCw size={15}/>
          </button>
        </div>

        {isConnected ? (
          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'20px',textAlign:'center'}}>
            <CheckCircle size={40} color="#22c55e" style={{marginBottom:'10px'}}/>
            <div style={{fontWeight:'800',color:'#16a34a',fontSize:'16px',marginBottom:'6px'}}>WhatsApp is Live!</div>
            <div style={{color:'#64748b',fontSize:'13px'}}>Notifications sent automatically on every stage change.</div>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'10px',padding:'16px',fontSize:'13px',color:'#92400e'}}>
              <div style={{fontWeight:'700',marginBottom:'10px'}}>How to Connect:</div>
              {['Click the green button below','Wait 10-20 seconds for QR to appear','Open WhatsApp on your phone','Go to Settings → Linked Devices → Link a Device','Scan the QR code - done!'].map((s,i)=>(
                <div key={i} style={{display:'flex',gap:'8px',marginBottom:'6px'}}>
                  <span style={{fontWeight:'800',color:'#d97706',minWidth:'18px'}}>{i+1}.</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>

            <button onClick={startAndGetQR} disabled={loading}
              style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'10px',padding:'15px',background:loading?'#94a3b8':'#22c55e',color:'white',border:'none',borderRadius:'10px',cursor:loading?'not-allowed':'pointer',fontSize:'15px',fontWeight:'800',boxShadow:loading?'none':'0 4px 12px rgba(34,197,94,0.4)'}}>
              <RefreshCw size={18} style={{animation:loading?'spin 1s linear infinite':'none'}}/>
              {loading ? 'Starting WAHA...' : isScanning ? 'Refresh QR Code' : 'Start Session + Get QR'}
            </button>

            {qrData && (
              <div style={{textAlign:'center',padding:'24px',background:'white',border:'3px solid #22c55e',borderRadius:'14px'}}>
                <div style={{fontWeight:'700',fontSize:'14px',color:'#16a34a',marginBottom:'16px'}}>Scan this QR with WhatsApp</div>
                {qrData.startsWith('data:image') ? (
                  <>
                    <img src={qrData} alt="QR" style={{width:'260px',height:'260px',borderRadius:'8px',border:'1px solid #e2e8f0'}}/>
                    <div style={{marginTop:'12px',fontSize:'11px',color:'#94a3b8'}}>QR expires in ~60s - click Refresh if expired</div>
                  </>
                ) : (
                  <div style={{background:'#f8fafc',borderRadius:'8px',padding:'14px',fontSize:'10px',fontFamily:'monospace',wordBreak:'break-all',color:'#475569',textAlign:'left',maxHeight:'160px',overflowY:'auto'}}>
                    {qrData.substring(0,300)}...
                  </div>
                )}
              </div>
            )}

            {!qrData && isScanning && (
              <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'10px',padding:'14px',textAlign:'center',fontSize:'13px',color:'#92400e'}}>
                <Smartphone size={22} color="#d97706" style={{marginBottom:'6px'}}/>
                <div style={{fontWeight:'700'}}>WAHA ready - click the button to get the QR code</div>
              </div>
            )}

            <div style={{textAlign:'center',padding:'10px',background:'#f8fafc',borderRadius:'8px',fontSize:'12px',color:'#64748b'}}>
              Or access WAHA dashboard:{' '}
              <a href="http://187.127.179.128:3002" target="_blank" rel="noreferrer" style={{color:'#3b82f6',display:'inline-flex',alignItems:'center',gap:'3px'}}>
                http://187.127.179.128:3002 <ExternalLink size={11}/>
              </a>
            </div>
          </div>
        )}
      </div>

      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'14px',padding:'24px'}}>
        <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>Auto WhatsApp Messages Sent on Stage Change</h3>
        {STAGE_MSGS.map(({stage,color,msg})=>(
          <div key={stage} style={{display:'flex',gap:'12px',padding:'10px 12px',borderRadius:'8px',background:'#f8fafc',marginBottom:'8px',alignItems:'flex-start'}}>
            <span style={{padding:'2px 9px',borderRadius:'4px',fontSize:'11px',fontWeight:'700',background:color+'15',color,flexShrink:0,marginTop:'2px'}}>{stage}</span>
            <span style={{fontSize:'12px',color:'#64748b',lineHeight:'1.5'}}>{msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
