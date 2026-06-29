'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Shield, Key, CheckCircle, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
export default function SecurityPage() {
  const {data:status,loading,refetch}=useFetch<any>('/2fa/status');
  const [busy,setBusy]=useState(false);const [qr,setQr]=useState<any>(null);const [tok,setTok]=useState('');const [disableTok,setDisableTok]=useState('');const [codes,setCodes]=useState<string[]>([]);
  async function setup(){setBusy(true);const r=await apiFetch('/2fa/setup',{method:'POST'});setQr(r);setBusy(false);}
  async function enable(){const r=await apiFetch('/2fa/enable',{method:'POST',body:JSON.stringify({token:tok})});setCodes(r.backup_codes||[]);setQr(null);refetch();}
  async function disable(){await apiFetch('/2fa/disable',{method:'POST',body:JSON.stringify({token:disableTok})});setDisableTok('');refetch();}
  const inputStyle={width:'100%',border:'1px solid #e2e8f0',borderRadius:'8px',padding:'9px',fontSize:'16px',textAlign:'center' as const,letterSpacing:'6px',fontFamily:'monospace',outline:'none',marginBottom:'8px',boxSizing:'border-box' as const};
  return(
    <div className="anim-fade-up space-y-6">
      <div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Security Settings</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Two-factor authentication · Account protection</p></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'16px'}}>
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'16px'}}>
            <div style={{width:'40px',height:'40px',borderRadius:'10px',background:status?.enabled?'#d1fae5':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center'}}>
              {status?.enabled?<CheckCircle size={20} style={{color:'#059669'}}/>:<AlertTriangle size={20} style={{color:'#ca8a04'}}/>}
            </div>
            <div><div style={{fontWeight:'700',fontSize:'14px',color:'#0f172a'}}>Two-Factor Authentication</div>
            <div style={{fontSize:'12px',color:'#64748b',marginTop:'1px'}}>{status?.enabled?'Active — Your account is protected':'Disabled — Enable for extra security'}</div></div>
          </div>
          {loading&&<Spinner size="sm"/>}
          {!loading&&!status?.enabled&&!qr&&<button onClick={setup} disabled={busy} style={{width:'100%',padding:'9px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>{busy?'Setting up...':'🔐 Enable 2FA'}</button>}
          {qr&&<div style={{textAlign:'center'}}>
            {qr.qr_base64&&<img src={`data:image/png;base64,${qr.qr_base64}`} style={{width:'180px',borderRadius:'8px',marginBottom:'12px',display:'block',margin:'0 auto 12px'}} alt="QR"/>}
            <p style={{fontSize:'12px',color:'#64748b',marginBottom:'10px'}}>Scan with Google Authenticator or Authy</p>
            <input value={tok} onChange={e=>setTok(e.target.value)} placeholder="6-digit code" maxLength={6} style={inputStyle}/>
            <button onClick={enable} disabled={tok.length!==6} style={{width:'100%',padding:'9px',background:'#059669',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',opacity:tok.length!==6?0.5:1}}>✓ Verify & Enable 2FA</button>
          </div>}
          {!loading&&status?.enabled&&<div>
            <div style={{fontSize:'12px',color:'#64748b',marginBottom:'10px'}}>Backup codes remaining: <strong>{status.backup_codes_remaining}</strong></div>
            <input value={disableTok} onChange={e=>setDisableTok(e.target.value)} placeholder="Enter code to disable" maxLength={6} style={inputStyle}/>
            <button onClick={disable} style={{width:'100%',padding:'9px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Disable 2FA</button>
          </div>}
          {codes.length>0&&<div style={{marginTop:'16px',padding:'14px',background:'#fef3c7',border:'1px solid #fde68a',borderRadius:'10px'}}>
            <div style={{fontWeight:'600',fontSize:'13px',color:'#92400e',marginBottom:'10px'}}>⚠️ Save these backup codes!</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>{codes.map((code,i)=><div key={i} style={{fontFamily:'monospace',fontSize:'13px',background:'white',padding:'5px 10px',borderRadius:'6px',textAlign:'center',fontWeight:'600',border:'1px solid #fde68a'}}>{code}</div>)}</div>
            <button onClick={()=>setCodes([])} style={{marginTop:'10px',width:'100%',padding:'6px',background:'transparent',border:'none',color:'#92400e',fontSize:'12px',cursor:'pointer',textDecoration:'underline'}}>I've saved these codes</button>
          </div>}
        </div>
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'16px'}}>
            <div style={{width:'40px',height:'40px',borderRadius:'10px',background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center'}}><Key size={20} style={{color:'#1e40af'}}/></div>
            <div><div style={{fontWeight:'700',fontSize:'14px',color:'#0f172a'}}>Google SSO</div><div style={{fontSize:'12px',color:'#64748b',marginTop:'1px'}}>Sign in with Google account</div></div>
          </div>
          <div style={{padding:'12px',background:'#f8fafc',borderRadius:'8px',fontSize:'12px',color:'#64748b',marginBottom:'12px'}}>Set <code style={{background:'#e2e8f0',padding:'1px 5px',borderRadius:'4px'}}>GOOGLE_CLIENT_ID</code> and <code style={{background:'#e2e8f0',padding:'1px 5px',borderRadius:'4px'}}>GOOGLE_CLIENT_SECRET</code> in your .env file to enable SSO.</div>
          <a href="http://187.127.179.128:8080/auth/sso/google" style={{display:'block',width:'100%',padding:'9px',background:'#4285f4',color:'white',borderRadius:'8px',fontSize:'13px',fontWeight:'600',textAlign:'center',textDecoration:'none'}}>🔑 Sign in with Google</a>
        </div>
      </div>
    </div>
  );
}
