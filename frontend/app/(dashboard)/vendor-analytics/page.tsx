'use client';
import { useState } from 'react';
import { useFetch } from '@/lib/useFetch';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const pct=(n:any)=>n!=null?`${Number(n).toFixed(1)}%`:'—';
export default function VendorAnalyticsPage() {
  const [tab,setTab]=useState('vendors');
  const {data:vendors}=useFetch<any[]>(tab==='vendors'?'/vendor-analytics/vendors':null);
  const {data:funnel}=useFetch<any[]>(tab==='funnel'?'/vendor-analytics/recruiter-funnel':null);
  const {data:diversity}=useFetch<any>(tab==='diversity'?'/vendor-analytics/diversity':null);
  const {data:sum}=useFetch<any>('/vendor-analytics/summary');
  return(
    <div data-testid="vendor-analytics-page" className="anim-fade-up space-y-6">
      <div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Vendor & Recruiter Analytics</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Vendor ROI · Recruiter funnel · Source attribution</p></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'14px'}}>
        {[['🏢','Active Vendors',sum?.active_vendors||0,'#1e40af','#eff6ff'],['📄','CVs Sourced',sum?.total_cvs||0,'#7c3aed','#ede9fe'],['✅','Placed',sum?.placed||0,'#059669','#d1fae5'],['💰','Total Spend',fmt(sum?.total_spend),'#92400e','#fef3c7']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div style={{display:'flex',borderBottom:'1px solid #e2e8f0'}}>
        {[['vendors','🏢 Vendors'],['funnel','📊 Recruiter Funnel'],['diversity','🌍 Diversity']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:'10px 18px',border:'none',background:'none',cursor:'pointer',fontSize:'13px',fontWeight:tab===k?'600':'400',color:tab===k?'#1e40af':'#64748b',borderBottom:tab===k?'2px solid #1e40af':'2px solid transparent',marginBottom:'-1px'}}>{l}</button>
        ))}
      </div>
      {tab==='vendors'&&<div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{['Vendor','Rating','CVs','Placed','Commission','Status'].map(h=><th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',color:'#64748b'}}>{h}</th>)}</tr></thead>
          <tbody>{(vendors||[]).map((v:any)=>(
            <tr key={v.id} style={{borderBottom:'1px solid #f1f5f9'}}>
              <td style={{padding:'10px 16px'}}><div style={{fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>{v.name}</div><div style={{fontSize:'11px',color:'#94a3b8'}}>{v.contact_person}</div></td>
              <td style={{padding:'10px 16px',fontSize:'13px',color:'#f59e0b'}}>{v.rating?`★ ${v.rating}`:'—'}</td>
              <td style={{padding:'10px 16px',fontWeight:'600'}}>{v.total_cvs||0}</td>
              <td style={{padding:'10px 16px'}}><span style={{fontSize:'11px',fontWeight:'700',padding:'3px 10px',borderRadius:'10px',background:'#d1fae5',color:'#059669'}}>{v.placements||0}</span></td>
              <td style={{padding:'10px 16px',fontSize:'12px',color:'#475569'}}>{v.commission_pct}%</td>
              <td style={{padding:'10px 16px'}}><span style={{fontSize:'11px',padding:'3px 10px',borderRadius:'10px',fontWeight:'600',background:v.status==='active'?'#d1fae5':'#f1f5f9',color:v.status==='active'?'#059669':'#64748b'}}>{v.status}</span></td>
            </tr>))}
            {!vendors?.length&&<tr><td colSpan={6} style={{textAlign:'center',padding:'32px',color:'#94a3b8',fontSize:'12px'}}>No vendor agencies yet</td></tr>}
          </tbody>
        </table>
      </div>}
      {tab==='funnel'&&<div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{['Recruiter','Submissions','Interviews','Offers','Placements','Conversion'].map(h=><th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',color:'#64748b'}}>{h}</th>)}</tr></thead>
          <tbody>{(funnel||[]).map((r:any)=>(
            <tr key={r.recruiter_id} style={{borderBottom:'1px solid #f1f5f9'}}>
              <td style={{padding:'10px 16px',fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>{r.full_name}</td>
              <td style={{padding:'10px 16px',fontWeight:'600'}}>{r.total_submissions}</td>
              <td style={{padding:'10px 16px'}}>{r.interviews}</td><td style={{padding:'10px 16px'}}>{r.offers}</td>
              <td style={{padding:'10px 16px'}}><span style={{fontWeight:'700',fontSize:'14px',color:'#059669'}}>{r.placements}</span></td>
              <td style={{padding:'10px 16px',fontSize:'12px',fontWeight:'600',color:'#1e40af'}}>{pct(r.sub_to_interview_pct)}</td>
            </tr>))}
            {!funnel?.length&&<tr><td colSpan={6} style={{textAlign:'center',padding:'32px',color:'#94a3b8',fontSize:'12px'}}>No funnel data yet</td></tr>}
          </tbody>
        </table>
      </div>}
      {tab==='diversity'&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:'16px'}}>
        {[['by_location','Location'],['by_source','Source'],['by_exp_band','Experience Band']].map(([key,title])=>(
          <div key={key} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <div style={{fontWeight:'700',fontSize:'13px',color:'#0f172a',marginBottom:'14px'}}>{title} Distribution</div>
            {(diversity?.[key]||[]).map((row:any)=>{const mx=Math.max(...(diversity?.[key]||[]).map((r:any)=>r.count));const label=row.location||row.source||row.band;return(
              <div key={label} style={{marginBottom:'10px'}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}><span style={{fontSize:'12px',color:'#374151',fontWeight:'500'}}>{label}</span><span style={{fontSize:'12px',color:'#64748b'}}>{row.count}</span></div><div style={{height:'6px',background:'#f1f5f9',borderRadius:'3px',overflow:'hidden'}}><div style={{height:'100%',background:'#1e40af',width:`${(row.count/mx)*100}%`,borderRadius:'3px'}}/></div></div>
            );})}
            {!diversity?.[key]?.length&&<div style={{textAlign:'center',padding:'20px',color:'#94a3b8',fontSize:'12px'}}>No data yet</div>}
          </div>
        ))}
      </div>}
    </div>
  );
}
