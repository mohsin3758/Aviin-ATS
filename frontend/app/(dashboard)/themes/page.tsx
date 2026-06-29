'use client';
import { useTheme, THEMES } from '@/components/providers/ThemeProvider';
import { Check, Palette } from 'lucide-react';
const DETAILS=[
  {desc:'Professional corporate style — navy blue and gold accents',best:'Enterprise clients, formal use'},
  {desc:'Modern SaaS — purple gradients and cyan accents',best:'Tech companies, startups'},
  {desc:'Clean ocean-inspired blue — excellent readability',best:'IT staffing, daily use'},
  {desc:'Dark mode with emerald green — reduces eye strain',best:'Night shift, long sessions'},
  {desc:'Warm orange and amber — energetic and friendly',best:'Creative teams'},
  {desc:'Ultra-clean minimal slate — maximum content focus',best:'Data-heavy workflows'},
];
export default function ThemesPage() {
  const {theme,setTheme}=useTheme();
  return(
    <div className="anim-fade-up space-y-6">
      <div style={{display:'flex',alignItems:'center',gap:'12px'}}><div style={{width:'44px',height:'44px',borderRadius:'12px',background:'var(--primary-bg)',display:'flex',alignItems:'center',justifyContent:'center'}}><Palette size={22} style={{color:'var(--primary)'}}/></div><div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Dashboard Themes</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>6 premium UI templates — click any to apply instantly</p></div></div>
      <div style={{padding:'14px 18px',background:'var(--primary)',borderRadius:'12px',color:'white',fontSize:'13px'}}><strong>Active:</strong> {THEMES.find(t=>t.id===theme)?.name} — {DETAILS[THEMES.findIndex(t=>t.id===theme)]?.desc||''}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'16px'}}>
        {THEMES.map((t,i)=>{
          const active=theme===t.id;const d=DETAILS[i];
          return(<div key={t.id} onClick={()=>setTheme(t.id)} style={{background:'white',border:`2px solid ${active?t.preview:'#e2e8f0'}`,borderRadius:'14px',overflow:'hidden',cursor:'pointer',transition:'all 0.2s',boxShadow:active?`0 0 0 4px ${t.preview}22`:''}}>
            <div style={{height:'100px',background:t.preview,position:'relative'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:'28px',background:'rgba(0,0,0,0.2)'}}/>
              <div style={{position:'absolute',top:0,left:'28px',right:0,height:'24px',background:'rgba(255,255,255,0.15)'}}/>
              <div style={{position:'absolute',top:'32px',left:'36px',right:'8px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'6px'}}>{[0,1,2].map(j=><div key={j} style={{height:'28px',borderRadius:'6px',background:'rgba(255,255,255,0.25)'}}/>)}</div>
              {active&&<div style={{position:'absolute',top:'8px',right:'8px',width:'24px',height:'24px',borderRadius:'50%',background:'white',display:'flex',alignItems:'center',justifyContent:'center'}}><Check size={13} style={{color:t.preview}}/></div>}
              {t.dark&&<div style={{position:'absolute',bottom:'6px',left:'36px',fontSize:'10px',background:'rgba(0,0,0,0.4)',color:'white',padding:'2px 7px',borderRadius:'4px'}}>Dark</div>}
            </div>
            <div style={{padding:'14px 16px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'6px'}}><span style={{fontWeight:'700',fontSize:'13px',color:'#0f172a'}}>{t.name}</span>{active&&<span style={{fontSize:'11px',fontWeight:'600',padding:'2px 8px',borderRadius:'10px',background:t.preview+'18',color:t.preview}}>Active</span>}</div>
              <p style={{fontSize:'12px',color:'#64748b',lineHeight:'1.5',marginBottom:'8px'}}>{d?.desc}</p>
              <div style={{fontSize:'11px',color:'#94a3b8'}}>Best for: <span style={{color:'#374151',fontWeight:'500'}}>{d?.best}</span></div>
            </div>
          </div>);
        })}
      </div>
    </div>
  );
}
