'use client';
import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, Smartphone, PowerOff } from 'lucide-react';
import { apiFetch, useFetch } from '@/lib/useFetch';

// Real per-user WhatsApp numbers (2026-08-27) — mirrors "My Email
// Accounts": connect YOUR OWN WhatsApp number instead of everyone
// sharing the one company number. Each personal session is a real,
// resource-costly WAHA browser session (~2GB RAM), so this is capped
// tenant-wide (Ops Settings > WhatsApp Sessions) — a clean, honest
// refusal is expected and correct when the server is already at
// capacity, not a bug.

export default function MyWhatsAppAccountPage() {
  const { data: account, refetch } = useFetch<any>('/user-whatsapp/account');
  const { data: config } = useFetch<any>('/user-whatsapp/config');
  const [qrData, setQrData] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [polling, setPolling] = useState(false);

  const showT = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500); };

  const startAndGetQR = async () => {
    setLoading(true); setQrData('');
    try {
      const started = await apiFetch('/user-whatsapp/account/start', { method: 'POST' });
      if (!started) { setLoading(false); return; }
      showT('Session starting... fetching QR in 6 seconds');
      await new Promise(res => setTimeout(res, 6000));
      try {
        const qr = await apiFetch('/user-whatsapp/account/qr');
        if (qr?.qr_data_url) {
          setQrData(qr.qr_data_url);
          showT('QR ready! Scan with your own WhatsApp now');
          setPolling(true);
        }
      } catch {
        showT('QR not ready yet — click "Refresh QR Code" again in a few seconds');
      }
    } catch (e: any) {
      showT(e?.message || 'Could not start a session — see below');
    } finally {
      setLoading(false);
      refetch();
    }
  };

  const stopSession = async () => {
    await apiFetch('/user-whatsapp/account/stop', { method: 'POST' });
    showT('Session stopped — your connection is saved, reconnect any time with no new QR scan needed');
    setQrData('');
    refetch();
  };

  const disconnect = async () => {
    if (!confirm('Fully disconnect your WhatsApp number? You will need to scan a new QR code to reconnect.')) return;
    await apiFetch('/user-whatsapp/account', { method: 'DELETE' });
    showT('Disconnected');
    setQrData('');
    refetch();
  };

  const toggleBot = async (enabled: boolean) => {
    await apiFetch('/user-whatsapp/account/bot-auto-reply', { method: 'PATCH', body: JSON.stringify({ enabled }) });
    refetch();
  };

  useEffect(() => {
    if (!polling) return;
    const iv = setInterval(async () => {
      await refetch();
    }, 8000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling]);

  useEffect(() => {
    if (account?.status === 'working' && polling) { setPolling(false); showT('WhatsApp Connected!'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.status]);

  const status = account?.status || 'stopped';
  const isConnected = status === 'working';
  const isScanning = status === 'scan_qr';
  const dotColor = isConnected ? '#22c55e' : isScanning ? '#d97706' : '#dc2626';
  const labelTxt = isConnected ? 'CONNECTED' : isScanning ? 'WAITING FOR QR SCAN' : status.toUpperCase();

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'24px',maxWidth:'640px'}}>
      {toast && (
        <div style={{position:'fixed',top:'80px',right:'24px',zIndex:1000,background:'#0f172a',color:'white',padding:'12px 20px',borderRadius:'8px',fontSize:'13px',fontWeight:'600',boxShadow:'0 4px 20px rgba(0,0,0,0.3)',maxWidth:'380px'}}>
          {toast}
        </div>
      )}

      <div>
        <h1 style={{fontSize:'20px',fontWeight:'800',color:'#0f172a',marginBottom:'4px'}}>My WhatsApp Account</h1>
        <p style={{fontSize:'13px',color:'#64748b'}}>Connect your own WhatsApp number — messages you send manually go out from YOUR real number, not the shared company one.</p>
      </div>

      {config && (
        <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'10px',padding:'12px 16px',fontSize:'12px',color:'#1e40af'}}>
          This server can run <strong>{config.max_concurrent_personal_sessions}</strong> personal WhatsApp session(s) at once
          (currently <strong>{config.active_sessions}</strong> active) — each one is a real, resource-heavy browser session, not
          an unlimited feature. If you hit the limit, ask an admin to free up a slot or raise it (Ops Settings).
        </div>
      )}

      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'14px',padding:'24px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'14px',marginBottom:'20px'}}>
          <div style={{width:'52px',height:'52px',borderRadius:'12px',background:dotColor+'15',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {isConnected ? <CheckCircle size={28} color="#22c55e"/> : isScanning ? <Smartphone size={28} color="#d97706"/> : <AlertCircle size={28} color="#dc2626"/>}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:'800',fontSize:'17px',color:'#0f172a'}}>
              {isConnected ? 'Your WhatsApp is Connected!' : 'Not Connected'}
            </div>
            <div style={{fontSize:'13px',marginTop:'3px'}}>
              Status: <strong style={{color:dotColor}}>{labelTxt}</strong>
              {isConnected && account?.phone_number && <span style={{color:'#64748b'}}> · {String(account.phone_number).replace('@c.us','')}</span>}
            </div>
          </div>
          <button onClick={() => refetch()} title="Refresh" style={{background:'none',border:'1px solid #e2e8f0',borderRadius:'8px',cursor:'pointer',color:'#94a3b8',padding:'8px',display:'flex',alignItems:'center'}}>
            <RefreshCw size={15}/>
          </button>
        </div>

        {isConnected ? (
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'20px',textAlign:'center'}}>
              <CheckCircle size={40} color="#22c55e" style={{marginBottom:'10px'}}/>
              <div style={{fontWeight:'800',color:'#16a34a',fontSize:'16px',marginBottom:'6px'}}>Your number is live!</div>
              <div style={{color:'#64748b',fontSize:'13px'}}>Manual WhatsApp sends from candidate pages will now go out from your own real number.</div>
            </div>
            <div style={{display:'flex',gap:'10px'}}>
              <button onClick={stopSession} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'8px',padding:'12px',background:'#f1f5f9',color:'#334155',border:'1px solid #e2e8f0',borderRadius:'10px',cursor:'pointer',fontSize:'13px',fontWeight:'700'}}>
                <PowerOff size={15}/> Pause (keep connection saved)
              </button>
              <button onClick={disconnect} style={{flex:1,padding:'12px',background:'white',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'10px',cursor:'pointer',fontSize:'13px',fontWeight:'700'}}>
                Disconnect fully
              </button>
            </div>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'10px',padding:'16px',fontSize:'13px',color:'#92400e'}}>
              <div style={{fontWeight:'700',marginBottom:'10px'}}>How to Connect:</div>
              {['Click the green button below','Wait 6-15 seconds for your QR to appear','Open WhatsApp on your OWN phone','Go to Settings → Linked Devices → Link a Device','Scan the QR code — done!'].map((s,i)=>(
                <div key={i} style={{display:'flex',gap:'8px',marginBottom:'6px'}}>
                  <span style={{fontWeight:'800',color:'#d97706',minWidth:'18px'}}>{i+1}.</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>

            <button onClick={startAndGetQR} disabled={loading}
              style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'10px',padding:'15px',background:loading?'#94a3b8':'#22c55e',color:'white',border:'none',borderRadius:'10px',cursor:loading?'not-allowed':'pointer',fontSize:'15px',fontWeight:'800',boxShadow:loading?'none':'0 4px 12px rgba(34,197,94,0.4)'}}>
              <RefreshCw size={18} style={{animation:loading?'spin 1s linear infinite':'none'}}/>
              {loading ? 'Starting...' : isScanning ? 'Refresh QR Code' : 'Connect My WhatsApp'}
            </button>

            {qrData && (
              <div style={{textAlign:'center',padding:'24px',background:'white',border:'3px solid #22c55e',borderRadius:'14px'}}>
                <div style={{fontWeight:'700',fontSize:'14px',color:'#16a34a',marginBottom:'16px'}}>Scan this QR with YOUR WhatsApp</div>
                <img src={qrData} alt="QR" style={{width:'260px',height:'260px',borderRadius:'8px',border:'1px solid #e2e8f0'}}/>
                <div style={{marginTop:'12px',fontSize:'11px',color:'#94a3b8'}}>QR expires quickly — click Refresh if it stops working</div>
              </div>
            )}

            {!qrData && isScanning && (
              <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'10px',padding:'14px',textAlign:'center',fontSize:'13px',color:'#92400e'}}>
                <Smartphone size={22} color="#d97706" style={{marginBottom:'6px'}}/>
                <div style={{fontWeight:'700'}}>Session ready — click the button above to get your QR code</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'14px',padding:'24px'}}>
        <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'6px'}}>Auto-reply bot commands on my number</h3>
        <p style={{fontSize:'12px',color:'#64748b',marginBottom:'14px'}}>
          When ON, a candidate texting your personal number can use STATUS / INTERVIEW / CALLBACK / ACCEPT / DECLINE and get the
          same automated reply as the shared company number. When OFF, your number is just a normal inbox — every message is
          still logged for you to see, but nothing auto-replies; you answer it yourself.
        </p>
        <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer'}}>
          <input type="checkbox" checked={account?.bot_auto_reply_enabled !== false}
            onChange={e => toggleBot(e.target.checked)}
            style={{width:'18px',height:'18px',cursor:'pointer'}}/>
          <span style={{fontSize:'13px',fontWeight:'600',color:'#334155'}}>
            {account?.bot_auto_reply_enabled !== false ? 'Bot auto-replies are ON' : 'Bot auto-replies are OFF — plain inbox only'}
          </span>
        </label>
      </div>
    </div>
  );
}
