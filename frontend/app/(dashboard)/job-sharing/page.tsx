'use client';
import { useState } from 'react';
import { Share2, ExternalLink, Copy } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch, apiFetch } from '@/lib/useFetch';
export default function JobSharingPage(){
  const {data:reqs}=useFetch<any[]>('/requisitions');
  const [selId,setSelId]=useState('');
  const {data:links,loading}=useFetch<any>(selId?`/job-sharing/requisition/${selId}`:null);
  const PLATFORMS=[{key:'linkedin',label:'LinkedIn',color:'bg-blue-600',url:(d:any)=>d.linkedin_share},
    {key:'naukri',label:'Naukri.com',color:'bg-red-600',url:(d:any)=>d.naukri_post},
    {key:'indeed',label:'Indeed',color:'bg-indigo-600',url:(d:any)=>d.indeed_post},
    {key:'whatsapp',label:'WhatsApp',color:'bg-green-600',url:(d:any)=>d.whatsapp_share},
    {key:'email',label:'Email',color:'bg-gray-600',url:(d:any)=>d.email_share}];
  return(<div className="space-y-6" data-testid="job-sharing-page">
    <div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-purple-50"><Share2 className="h-5 w-5 text-purple-600"/></div>
      <div><h1 className="text-2xl font-bold">Job Board Sharing</h1><p className="text-sm text-gray-500">Share jobs to LinkedIn · Naukri · Indeed · WhatsApp</p></div></div>
    <Card><CardHeader><h2 className="font-semibold">Select Open Requisition</h2></CardHeader><CardContent>
      <select value={selId} onChange={e=>setSelId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
        <option value="">Choose requisition...</option>
        {(reqs||[]).filter((r:any)=>r.status==='open').map((r:any)=><option key={r.id} value={r.id}>{r.title} — {r.location}</option>)}
      </select>
    </CardContent></Card>
    {selId&&(loading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:links&&(<>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {PLATFORMS.map(({key,label,color,url})=>(
          <a key={key} href={url(links)} target="_blank" rel="noopener noreferrer"
             onClick={()=>apiFetch('/job-sharing/log',{method:'POST',body:JSON.stringify({req_id:selId,platform:key})})}
             className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium text-white ${color} hover:opacity-90`}>
            <ExternalLink className="h-3.5 w-3.5"/>{label}
          </a>
        ))}
      </div>
      <Card><CardHeader><div className="flex items-center justify-between"><h2 className="font-semibold">WhatsApp Message</h2>
        <button onClick={()=>navigator.clipboard.writeText(links.whatsapp_message)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border rounded px-2 py-1"><Copy className="h-3 w-3"/>Copy</button>
      </div></CardHeader><CardContent><pre className="text-sm bg-gray-50 rounded-xl p-4 whitespace-pre-wrap font-sans">{links.whatsapp_message}</pre></CardContent></Card>
    </>))}
  </div>);
}