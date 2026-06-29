'use client';
import { useState } from 'react';
import { Shield, CheckCircle, Clock } from 'lucide-react';

export default function BgvPage() {
  const [bgvTab, setBgvTab] = useState('overview');

  return (
    <div className="anim-fade-up space-y-6">
      <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
        <button onClick={()=>setBgvTab('overview')} data-tab="overview" style={{padding:'8px 16px',background:bgvTab==='overview'?'#4f46e5':'#e5e7eb',color:bgvTab==='overview'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',fontSize:'13px'}}>Overview</button>
        <button onClick={()=>setBgvTab('checks')} data-tab="checks" style={{padding:'8px 16px',background:bgvTab==='checks'?'#4f46e5':'#e5e7eb',color:bgvTab==='checks'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',fontSize:'13px'}}>Checks</button>
        <button onClick={()=>setBgvTab('india-verify')} data-tab="india-verify" style={{padding:'8px 16px',background:bgvTab==='india-verify'?'#4f46e5':'#e5e7eb',color:bgvTab==='india-verify'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',fontSize:'13px'}}>India Verify</button>
      </div>

      <div data-testid="trust-overview" style={{display: bgvTab === 'overview' ? 'block' : 'none', padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',minHeight:'80px'}}>
        <div style={{display:'flex',gap:'12px',alignItems:'center'}}>
          <Shield size={24} style={{color:'#4f46e5'}} />
          <div>
            <div style={{fontWeight:'700',fontSize:'16px',color:'#0f172a'}}>BGV Trust Overview</div>
            <div style={{fontSize:'13px',color:'#64748b',marginTop:'4px'}}>
              Background verification dashboard for all candidates.
            </div>
          </div>
        </div>
        <div style={{marginTop:'16px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
          <div style={{padding:'14px',background:'#f0fdf4',borderRadius:'10px',border:'1px solid #bbf7d0',textAlign:'center'}}>
            <CheckCircle size={20} style={{color:'#16a34a',margin:'0 auto 6px'}} />
            <div style={{fontWeight:'700',fontSize:'18px',color:'#16a34a'}}>0</div>
            <div style={{fontSize:'12px',color:'#64748b'}}>Verified</div>
          </div>
          <div style={{padding:'14px',background:'#fefce8',borderRadius:'10px',border:'1px solid #fef08a',textAlign:'center'}}>
            <Clock size={20} style={{color:'#ca8a04',margin:'0 auto 6px'}} />
            <div style={{fontWeight:'700',fontSize:'18px',color:'#ca8a04'}}>0</div>
            <div style={{fontSize:'12px',color:'#64748b'}}>In Progress</div>
          </div>
          <div style={{padding:'14px',background:'#fef2f2',borderRadius:'10px',border:'1px solid #fecaca',textAlign:'center'}}>
            <Shield size={20} style={{color:'#dc2626',margin:'0 auto 6px'}} />
            <div style={{fontWeight:'700',fontSize:'18px',color:'#dc2626'}}>0</div>
            <div style={{fontSize:'12px',color:'#64748b'}}>Pending</div>
          </div>
        </div>
      </div>

      <div data-testid="bgv-checks-panel" style={{display: bgvTab === 'checks' ? 'block' : 'none', padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',minHeight:'80px'}}>
        <h3 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',marginBottom:'12px'}}>Background Verification Checks</h3>
        <p style={{fontSize:'13px',color:'#64748b'}}>Education, Employment, Criminal, Address, and Reference checks.</p>
        <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'8px'}}>
          {['Education Verification','Employment History','Criminal Record','Address Check','Reference Check'].map(c=>(
            <div key={c} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 14px',background:'#f8fafc',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
              <Clock size={14} style={{color:'#94a3b8'}} />
              <span style={{fontSize:'13px',color:'#374151'}}>{c}</span>
              <span style={{marginLeft:'auto',fontSize:'11px',padding:'2px 8px',background:'#e2e8f0',borderRadius:'4px',color:'#64748b'}}>Pending</span>
            </div>
          ))}
        </div>
      </div>

      <div data-testid="india-verify-panel" style={{display: bgvTab === 'india-verify' ? 'block' : 'none', padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',minHeight:'80px'}}>
        <h3 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',marginBottom:'12px'}}>India Verify Integration</h3>
        <p style={{fontSize:'13px',color:'#64748b'}}>Aadhaar, PAN, Driving License, and Voter ID verification.</p>
        <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'8px'}}>
          {['Aadhaar Verification','PAN Card Check','Driving License','Voter ID'].map(c=>(
            <div key={c} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 14px',background:'#f8fafc',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
              <Shield size={14} style={{color:'#94a3b8'}} />
              <span style={{fontSize:'13px',color:'#374151'}}>{c}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
