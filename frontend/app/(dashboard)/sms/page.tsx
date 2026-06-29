'use client';
import { useState } from 'react';
import { MessageSquare, Send, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';
const TMPLS=['interview_reminder','shortlist','offer','placement_confirm'];
export default function SmsPage(){
  const {data:st}=useFetch<any>('/sms/status');
  const {data:log,loading,refetch}=useFetch<any[]>('/sms/log');
  const [phone,setPhone]=useState('');const [msg,setMsg]=useState('');const [tmpl,setTmpl]=useState('');const [busy,setBusy]=useState(false);
  async function send(){setBusy(true);try{await apiFetch('/sms/send',{method:'POST',body:JSON.stringify({to_phone:phone,message:tmpl?undefined:msg,template:tmpl||undefined})});refetch();setMsg('');}finally{setBusy(false);}};
  return(<div className="space-y-6" data-testid="sms-page">
    <div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-green-50"><MessageSquare className="h-5 w-5 text-green-600"/></div>
      <div><h1 className="text-2xl font-bold">SMS Notifications</h1><p className="text-sm text-gray-500">MSG91 integration · Set MSG91_API_KEY in .env to enable</p></div></div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card><CardHeader><h2 className="font-semibold">Status</h2></CardHeader><CardContent>
        <div className={`flex items-center gap-2 mb-4 ${st?.configured?'text-green-700':'text-amber-700'}`}>
          {st?.configured?<CheckCircle className="h-5 w-5"/>:<XCircle className="h-5 w-5"/>}
          <span className="font-medium">{st?.configured?'MSG91 Connected':'Not configured'}</span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[['Total',st?.total],['Sent',st?.sent],['Failed',st?.failed]].map(([l,v])=>(
            <div key={l as string} className="bg-gray-50 rounded-lg p-3"><div className="text-xl font-bold">{v||0}</div><div className="text-xs text-gray-400">{l}</div></div>
          ))}
        </div>
      </CardContent></Card>
      <Card><CardHeader><h2 className="font-semibold">Send SMS</h2></CardHeader><CardContent>
        <div className="space-y-3">
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+91 9876543210" className="w-full border rounded-lg px-3 py-2 text-sm"/>
          <select value={tmpl} onChange={e=>setTmpl(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">Custom message</option>{TMPLS.map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </select>
          {!tmpl&&<textarea value={msg} onChange={e=>setMsg(e.target.value)} rows={3} placeholder="Message..." className="w-full border rounded-lg px-3 py-2 text-sm"/>}
          <button onClick={send} disabled={busy||!phone} className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy?<Spinner size="sm"/>:<Send className="h-4 w-4"/>}Send
          </button>
        </div>
      </CardContent></Card>
    </div>
    <Card><CardHeader><h2 className="font-semibold">SMS Log</h2></CardHeader><CardContent className="p-0">
      {loading?<div className="flex justify-center py-8"><Spinner/></div>:<Table><Thead><tr><Th>Time</Th><Th>To</Th><Th>Template</Th><Th>Status</Th></tr></Thead>
        <Tbody>{!log?.length?<Tr><Td colSpan={4} className="text-center py-8 text-gray-400 text-sm">No SMS sent yet</Td></Tr>:(log||[]).map((s:any)=>(
          <Tr key={s.id}><Td className="text-xs text-gray-400">{new Date(s.created_at).toLocaleString('en-IN')}</Td>
            <Td className="text-sm font-mono">{s.to_phone}</Td>
            <Td><span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{s.template}</span></Td>
            <Td><span className={`text-xs px-2 py-0.5 rounded-full ${s.status==='sent'?'bg-green-100 text-green-700':s.status==='failed'?'bg-red-100 text-red-600':'bg-gray-100 text-gray-500'}`}>{s.status}</span></Td>
          </Tr>))}
        </Tbody></Table>}
    </CardContent></Card>
  </div>);
}