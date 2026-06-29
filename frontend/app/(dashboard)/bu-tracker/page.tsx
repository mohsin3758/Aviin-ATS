'use client';
import { Building2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';

function fmt(n:any){if(n==null)return'—';return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);}
function KpiCard({icon:Icon,label,value,color,bg}:any){return(<Card><CardContent className="flex items-center gap-3 py-5"><div className={`p-2.5 rounded-xl ${bg} ${color} shrink-0`}><Icon className="h-5 w-5"/></div><div className="min-w-0"><p className="text-xl font-bold text-gray-900 truncate">{value===null?<Spinner size="sm"/>:value}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p></div></CardContent></Card>);}

export default function BuTrackerPage(){
  const {data:accounts,loading,refetch}=useFetch<any[]>('/bu-tracker');
  const eligible=accounts?.filter(a=>a.is_eligible&&!a.bu_created).length||0;
  const created=accounts?.filter(a=>a.bu_created).length||0;
  const total=accounts?.length||0;

  async function createBu(id:string){await apiFetch(`/bu-tracker/${id}/create-bu`,{method:'PATCH'});refetch();}

  return(
    <div className="space-y-6" data-testid="bu-tracker-page">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[--color-primary]/10"><Building2 className="h-5 w-5 text-[--color-primary]"/></div>
        <div><h1 className="text-2xl font-bold text-gray-900">P17 BU Tracker</h1><p className="text-sm text-gray-500">Business Unit eligibility per client account</p></div>
      </div>
      <div className="grid grid-cols-3 gap-4" data-testid="bu-kpis">
        <KpiCard icon={Building2} label="Total Accounts" color="text-blue-600" bg="bg-blue-50" value={loading?null:total}/>
        <KpiCard icon={CheckCircle} label="Eligible for BU" color="text-green-600" bg="bg-green-50" value={loading?null:eligible}/>
        <KpiCard icon={Clock} label="BUs Created" color="text-purple-600" bg="bg-purple-50" value={loading?null:created}/>
      </div>
      <Card>
        <CardHeader><h2 className="font-semibold text-gray-800">BU Eligibility Status</h2><p className="text-xs text-gray-400 mt-0.5">POST /bu-tracker to add/update. PATCH /bu-tracker/:id/create-bu to mark created.</p></CardHeader>
        <CardContent className="p-0">
          {loading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
            <Table><Thead><tr><Th>Client</Th><Th>Min Monthly Rev</Th><Th>Min CM%</Th><Th>Months Active</Th><Th>Active Pos.</Th><Th>Eligible</Th><Th>BU Created</Th><Th>BU Head</Th><Th>Action</Th></tr></Thead>
              <Tbody>
                {!accounts?.length?<Tr><Td colSpan={9} className="text-center text-gray-400 py-10 text-sm">No BU tracker data. POST /bu-tracker to add.</Td></Tr>:accounts.map(a=>(
                  <Tr key={a.id}>
                    <Td className="font-medium text-sm">{a.client_name||a.client_id?.slice(0,8)}</Td>
                    <Td>{fmt(a.min_monthly_revenue)}</Td>
                    <Td>{a.min_cm_pct}%</Td>
                    <Td>{a.months_active}</Td>
                    <Td>{a.active_positions}</Td>
                    <Td>{a.is_eligible?<CheckCircle className="h-4 w-4 text-green-500"/>:<XCircle className="h-4 w-4 text-gray-300"/>}</Td>
                    <Td>{a.bu_created?<CheckCircle className="h-4 w-4 text-purple-500"/>:<XCircle className="h-4 w-4 text-gray-300"/>}</Td>
                    <Td className="text-xs text-gray-500">{a.bu_head_name||'—'}</Td>
                    <Td>{a.is_eligible&&!a.bu_created&&<button onClick={()=>createBu(a.id)} className="text-xs bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700">Create BU</button>}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
