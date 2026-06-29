'use client';
import { useState } from 'react';
import { Globe, MapPin, Clock, Search, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch } from '@/lib/useFetch';
export default function JobBoardPage(){
  const [search,setSearch]=useState('');const [loc,setLoc]=useState('');
  const {data:jobs,loading}=useFetch<any[]>(`/jobs${search||loc?`?search=${search}&location=${loc}`:''}`);
  return(
    <div className="space-y-6" data-testid="jobs-page">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-50"><Globe className="h-5 w-5 text-indigo-600"/></div>
        <div><h1 className="text-2xl font-bold text-gray-900">Job Board</h1>
        <p className="text-sm text-gray-500">{jobs?.length||0} open positions · Share link for direct applications</p></div>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by role or skill..." className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"/></div>
        <input value={loc} onChange={e=>setLoc(e.target.value)} placeholder="Location..." className="border rounded-lg px-3 py-2 text-sm w-48"/>
      </div>
      {loading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {!jobs?.length?<div className="col-span-2 text-center py-10 text-gray-400">No open positions found.</div>:jobs.map((j:any)=>(
          <Card key={j.id} className="hover:shadow-md transition-shadow">
            <CardContent className="py-4 px-5">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold text-gray-900">{j.title}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3"/>{j.location||'Remote'}</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3"/>{j.positions_count} opening{j.positions_count>1?'s':''}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3"/>{new Date(j.created_at).toLocaleDateString('en-IN')}</span>
                  </div>
                </div>
                <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full shrink-0 capitalize">{j.employment_type}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-3">
                {(j.skills_required||[]).slice(0,5).map((s:string)=>(
                  <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{s}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>}
    </div>
  );
}