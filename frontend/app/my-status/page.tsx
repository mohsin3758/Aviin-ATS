'use client';
import { useEffect, useState } from 'react';
import { CheckCircle, Clock, XCircle, Calendar, ExternalLink } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
export default function MyStatusPage(){
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const token=params.get('token');
    if(!token){setError('Invalid link. Contact your recruiter.');setLoading(false);return;}
    fetch(`/api/candidate-status/public?token=${token}`)
      .then(r=>{if(!r.ok)throw new Error('Invalid or expired link');return r.json();})
      .then(d=>setData(d))
      .catch(e=>setError(e.message))
      .finally(()=>setLoading(false));
  },[]);
  if(loading)return(<div className="min-h-screen flex items-center justify-center"><Spinner size="lg"/></div>);
  if(error)return(<div className="min-h-screen flex items-center justify-center"><div className="text-center"><div className="text-4xl mb-4">🔗</div><h1 className="text-xl font-bold text-gray-800 mb-2">Link Error</h1><p className="text-gray-500">{error}</p></div></div>);
  return(
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-white mb-1">AVIIN Jobs</div>
          <div className="text-blue-300 text-sm">Your Application Tracker</div>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
          <h1 className="text-xl font-bold text-gray-900">Hi, {data?.candidate?.name}!</h1>
          <p className="text-sm text-gray-400 mt-0.5">{data?.candidate?.email}</p>
        </div>
        {data?.upcoming_interviews?.length>0&&(
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5 mb-4">
            <h2 className="font-semibold text-purple-800 mb-3 flex items-center gap-2"><Calendar className="h-4 w-4"/>Upcoming Interviews</h2>
            {data.upcoming_interviews.map((iv:any,i:number)=>(
              <div key={i} className="bg-white rounded-xl p-4 mb-3 border border-purple-100 last:mb-0">
                <div className="font-medium text-gray-900">{iv.role}</div>
                <div className="text-sm text-purple-700 mt-1">📅 {iv.when}</div>
                <div className="text-xs text-gray-400">{iv.type} · {iv.mode}</div>
                {iv.link&&<a href={iv.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 underline mt-1"><ExternalLink className="h-3 w-3"/>Join Meeting</a>}
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3">
          {data?.applications?.map((app:any,i:number)=>(
            <div key={i} className="bg-white rounded-2xl shadow-sm border p-5">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-semibold text-gray-900">{app.role}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{app.client} · Updated {app.updated}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold" style={{color:app.color}}>{app.label}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {app.stage==='hired'||app.stage==='shortlisted'?<CheckCircle className="h-4 w-4 text-green-500"/>:app.stage==='rejected'?<XCircle className="h-4 w-4 text-red-500"/>:<Clock className="h-4 w-4 text-amber-500"/>}
                <span className="text-sm text-gray-600">{app.message}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-blue-300 text-xs mt-6">{data?.message}</p>
      </div>
    </div>
  );
}