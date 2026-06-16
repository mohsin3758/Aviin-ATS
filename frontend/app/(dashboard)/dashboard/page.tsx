'use client';

import { Briefcase, Users, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch } from '@/lib/useFetch';

interface Requisition { id: string; status: string; title: string; }
interface Candidate { id: string; full_name: string; }
interface FunnelRow { client_id: string; client_name: string; submittals_count: number; offers_count: number; placements_count: number; }
interface CapacityRow { recruiter_id: string; full_name: string; capacity_weekly: number; active_assignments: number; utilization_pct: number; }
interface RedeployRow { placement_id: string; candidate_id: string; candidate_name: string; client_name: string; end_date: string; days_remaining: number; }

export default function DashboardPage() {
  const { data: reqs, loading: reqsLoading } = useFetch<Requisition[]>('/requisitions');
  const { data: candidates } = useFetch<Candidate[]>('/candidates');
  const { data: funnel } = useFetch<FunnelRow[]>('/analytics/agency-funnel');
  const { data: capacity, loading: capLoading } = useFetch<CapacityRow[]>('/analytics/recruiter-capacity');
  const { data: redeployQueue, loading: rdLoading } = useFetch<RedeployRow[]>('/analytics/redeployment-queue');

  const openReqs = reqsLoading ? null : (reqs?.filter(r => r.status === 'open').length ?? 0);
  const totalCandidates = candidates?.length ?? null;
  const totalPlacements = funnel?.reduce((s, r) => s + (r.placements_count ?? 0), 0) ?? null;
  const redeployCount = redeployQueue?.length ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">T1 Command Center</h1>
        <p className="text-sm text-gray-500 mt-1">Live overview of your recruitment pipeline</p>
      </div>

      {/* KPI stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="stat-cards">
        <StatCard icon={Briefcase} label="Open Requisitions" value={openReqs} color="text-blue-600" bg="bg-blue-50" />
        <StatCard icon={Users} label="Active Candidates" value={totalCandidates} color="text-green-600" bg="bg-green-50" />
        <StatCard icon={TrendingUp} label="Placements" value={totalPlacements} color="text-purple-600" bg="bg-purple-50" />
        <StatCard icon={AlertTriangle} label="Ending in 21 Days" value={redeployCount} color="text-amber-600" bg="bg-amber-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Redeployment Queue */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Redeployment Queue
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Contractors ending within 21 days</p>
          </CardHeader>
          <CardContent className="p-0">
            {rdLoading ? (
              <div className="flex justify-center p-6"><Spinner /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Candidate</Th>
                    <Th>Client</Th>
                    <Th>Ends</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!redeployQueue || redeployQueue.length === 0) ? (
                    <Tr>
                      <Td colSpan={3} className="text-center text-gray-400 py-6">
                        No upcoming redeployments
                      </Td>
                    </Tr>
                  ) : redeployQueue.map(r => (
                    <Tr key={r.placement_id}>
                      <Td className="font-medium text-gray-800">{r.candidate_name}</Td>
                      <Td className="text-gray-600">{r.client_name ?? '—'}</Td>
                      <Td className="text-gray-500">{r.end_date?.slice(0, 10)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recruiter Capacity */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Recruiter Capacity</h2>
            <p className="text-xs text-gray-500 mt-0.5">Active assignments vs weekly capacity</p>
          </CardHeader>
          <CardContent>
            {capLoading ? (
              <div className="flex justify-center p-4"><Spinner /></div>
            ) : (!capacity || capacity.length === 0) ? (
              <p className="text-sm text-gray-400 text-center py-4">No recruiter data</p>
            ) : (
              <div className="space-y-4" data-testid="capacity-bars">
                {capacity.map(r => (
                  <div key={r.recruiter_id}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-gray-700">{r.full_name}</span>
                      <span className="text-xs text-gray-500">
                        {r.active_assignments}/{r.capacity_weekly} ({r.utilization_pct}%)
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={[
                          'h-full rounded-full transition-all',
                          r.utilization_pct >= 90 ? 'bg-red-500' :
                          r.utilization_pct >= 70 ? 'bg-amber-400' : 'bg-green-500',
                        ].join(' ')}
                        style={{ width: `${Math.min(r.utilization_pct, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agency Funnel */}
      {funnel && funnel.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Agency Funnel by Client</h2>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <Thead>
                <tr>
                  <Th>Client</Th>
                  <Th>Submittals</Th>
                  <Th>Offers</Th>
                  <Th>Placements</Th>
                </tr>
              </Thead>
              <Tbody>
                {funnel.map(r => (
                  <Tr key={r.client_id}>
                    <Td className="font-medium text-gray-800">{r.client_name}</Td>
                    <Td>{r.submittals_count}</Td>
                    <Td>{r.offers_count}</Td>
                    <Td>{r.placements_count}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, color, bg,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  color: string;
  bg: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className={`p-2.5 rounded-lg ${bg} ${color} shrink-0`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-gray-900">
            {value === null ? <Spinner size="sm" /> : value}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
