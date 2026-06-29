'use client';
import Link from 'next/link';
export default function Page() {
  return(
    <div className="anim-fade-up space-y-6">
      <div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>🔄 Nurture Sequences</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Automated candidate engagement drip sequences</p></div>
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',padding:'60px 20px',textAlign:'center'}}>
        <div style={{fontSize:'56px',marginBottom:'16px'}}>🔄</div>
        <h3 style={{fontSize:'18px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>Nurture Sequences</h3>
        <p style={{fontSize:'13px',color:'#9ca3af',marginBottom:'24px',maxWidth:'400px',margin:'0 auto 24px'}}>Automated candidate engagement drip sequences</p>
        <div style={{display:'flex',gap:'10px',justifyContent:'center',flexWrap:'wrap'}}>
          <Link href="/dashboard" style={{padding:'9px 20px',background:'#1e40af',color:'white',borderRadius:'8px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>← Back to Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
