'use client';

import { TrendingUp, Users, Target, AlertTriangle, Activity, Zap, Shield } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch } from '@/lib/useFetch';

interface FunnelRow { client_id: string; client_name: string; submittals_count: number; offers_count: number; placements_count: number; }
interface CapacityRow { recruiter_id: string; full_name: string; capacity_weekly: number; active_assignments: number; utilization_pct: number; }
interface SkillGapRow { skill: string; demand_count: number; supply_count: number; gap: number; }
interface RedeployRow { candidate_name: string; client_name: string; end_date: string; days_remaining: number; }
interface Requisition { id: string; status: string; }

export default function WarRoomPage() {
  const { data: funnel } = useFetch<FunnelRow[]>('/analytics/agency-funnel');
  const { data: capacity } = useFetch<CapacityRow[]>('/analytics/recruiter-capacity');
  const { data: skillGap } = useFetch<SkillGapRow[]>('/analytics/skill-gap');
  const { data: redeployQueue } = useFetch<RedeployRow[]>('/analytics/redeployment-queue');
  const { data: reqs } = useFetch<Requisition[]>('/requisitions');

  // Derived metrics
  const totalPlacements = funnel?.reduce((s, r) => s + r.placements_count, 0) ?? null;
  const totalSubmittals = funnel?.reduce((s, r) => s + r.submittals_count, 0) ?? 0;
  const fillRate = totalSubmittals > 0 && totalPlacements !== null
    ? Math.round((totalPlacements / totalSubmittals) * 100)
    : null;

  const totalCapacity = capacity?.reduce((s, r) => s + r.capacity_weekly, 0) ?? 0;
  const totalAssigned = capacity?.reduce((s, r) => s + r.active_assignments, 0) ?? 0;
  const avgUtilization = capacity
    ? Math.round(capacity.reduce((s, r) => s + r.utilization_pct, 0) / Math.max(capacity.length, 1))
    : null;

  const openReqs = reqs?.filter(r => r.status === 'open').length ?? null;
  const headroom = totalCapacity - totalAssigned;

  // Rule-based: Capacity vs Demand model
  const capacityRisk: 'critical' | 'warning' | 'healthy' | null =
    openReqs === null || capacity === null ? null :
    openReqs > headroom ? 'critical' :
    openReqs > headroom * 0.7 ? 'warning' : 'healthy';

  // Rule-based: Retention risk (redeployment queue severity)
  const retentionCritical = redeployQueue?.filter(r => r.days_remaining <= 7) ?? [];
  const retentionWarning = redeployQueue?.filter(r => r.days_remaining > 7 && r.days_remaining <= 14) ?? [];

  // Top clients by placements
  const topClients = funnel
    ? [...funnel].sort((a, b) => b.placements_count - a.placements_count).slice(0, 4)
    : [];

  // Skill shortage top 5 by gap
  const topGaps = skillGap
    ? [...skillGap].filter(s => s.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 5)
    : [];

  const loaded = funnel !== null && capacity !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[--color-primary]/10">
          <Shield className="h-5 w-5 text-[--color-primary]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">T5 War Room</h1>
          <p className="text-sm text-gray-500">CEO executive overview · predictive models: retention risk + capacity vs demand</p>
        </div>
      </div>

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="war-room-kpis">
        <HeroCard label="Total Placements" value={totalPlacements} icon={TrendingUp} color="text-green-600" bg="bg-green-50" />
        <HeroCard label="Fill Rate" value={fillRate !== null ? `${fillRate}%` : null} icon={Target} color="text-blue-600" bg="bg-blue-50" />
        <HeroCard label="Avg Utilization" value={avgUtilization !== null ? `${avgUtilization}%` : null} icon={Activity} color="text-purple-600" bg="bg-purple-50" />
        <HeroCard label="Skill Gaps" value={skillGap ? skillGap.filter(s => s.gap > 0).length : null} icon={Zap} color="text-amber-600" bg="bg-amber-50" />
      </div>

      {!loaded && (
        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
      )}

      {loaded && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Capacity vs Demand */}
          <Card data-testid="capacity-demand-panel">
            <CardHeader>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Capacity vs Demand Model
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Rule-based: headroom = capacity − active assignments vs open reqs</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-[--color-surface-alt] rounded-lg p-3">
                  <p className="text-xl font-bold text-gray-900">{totalCapacity}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Total Capacity</p>
                </div>
                <div className="bg-[--color-surface-alt] rounded-lg p-3">
                  <p className="text-xl font-bold text-gray-900">{totalAssigned}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Assigned</p>
                </div>
                <div className="bg-[--color-surface-alt] rounded-lg p-3">
                  <p className="text-xl font-bold text-gray-900">{openReqs ?? '…'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Open Reqs</p>
                </div>
              </div>
              <div className={`rounded-lg p-4 flex items-center gap-3 ${
                capacityRisk === 'critical' ? 'bg-red-50 border border-red-200' :
                capacityRisk === 'warning' ? 'bg-amber-50 border border-amber-200' :
                'bg-green-50 border border-green-200'
              }`}>
                <AlertTriangle className={`h-5 w-5 shrink-0 ${
                  capacityRisk === 'critical' ? 'text-red-500' :
                  capacityRisk === 'warning' ? 'text-amber-500' : 'text-green-500'
                }`} />
                <div>
                  <p className={`text-sm font-semibold ${
                    capacityRisk === 'critical' ? 'text-red-700' :
                    capacityRisk === 'warning' ? 'text-amber-700' : 'text-green-700'
                  }`}>
                    {capacityRisk === 'critical' ? 'Capacity Critical' :
                     capacityRisk === 'warning' ? 'Capacity Warning' : 'Capacity Healthy'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Headroom: {headroom} slots · Open requirements: {openReqs ?? '…'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Retention Risk */}
          <Card data-testid="retention-risk-panel">
            <CardHeader>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Retention Risk Model
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {retentionCritical.length} critical (≤7d) · {retentionWarning.length} warning (8–14d)
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <Thead><tr><Th>Contractor</Th><Th>Client</Th><Th>Risk</Th><Th>Days</Th></tr></Thead>
                <Tbody>
                  {redeployQueue?.length === 0 ? (
                    <Tr><Td colSpan={4} className="text-center text-gray-400 py-6 text-sm">
                      No contractors ending in 21 days — retention healthy
                    </Td></Tr>
                  ) : redeployQueue?.map((r, i) => (
                    <Tr key={i}>
                      <Td className="font-medium text-gray-800">{r.candidate_name}</Td>
                      <Td className="text-gray-600 text-sm">{r.client_name ?? '—'}</Td>
                      <Td>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          r.days_remaining <= 7 ? 'bg-red-100 text-red-700' :
                          r.days_remaining <= 14 ? 'bg-amber-100 text-amber-700' :
                          'bg-yellow-50 text-yellow-700'
                        }`}>
                          {r.days_remaining <= 7 ? 'Critical' : r.days_remaining <= 14 ? 'Warning' : 'Watch'}
                        </span>
                      </Td>
                      <Td className="text-xs text-gray-500">{r.days_remaining}d</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </CardContent>
          </Card>

          {/* Top clients */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-800">Top Clients by Performance</h2>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <Thead><tr><Th>Client</Th><Th>Submittals</Th><Th>Offers</Th><Th>Placed</Th></tr></Thead>
                <Tbody>
                  {topClients.length === 0 ? (
                    <Tr><Td colSpan={4} className="text-center text-gray-400 py-4">No data</Td></Tr>
                  ) : topClients.map(c => (
                    <Tr key={c.client_id}>
                      <Td className="font-medium text-gray-800">{c.client_name}</Td>
                      <Td>{c.submittals_count}</Td>
                      <Td>{c.offers_count}</Td>
                      <Td>
                        <span className={`text-sm font-semibold ${c.placements_count > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {c.placements_count}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </CardContent>
          </Card>

          {/* Skill Shortage */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Zap className="h-4 w-4 text-[--color-primary]" />
                Skill Shortage Alert
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Top unfilled skill demands vs candidate pool</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {topGaps.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No skill shortages detected</p>
              ) : topGaps.map(g => (
                <div key={g.skill}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium text-gray-800">{g.skill}</span>
                    <span className="text-xs text-gray-500">
                      {g.supply_count}/{g.demand_count} filled · gap {g.gap}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-red-400"
                      style={{ width: `${Math.min((g.gap / Math.max(g.demand_count, 1)) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function HeroCard({
  label, value, icon: Icon, color, bg,
}: {
  label: string; value: string | number | null;
  icon: React.ComponentType<{ className?: string }>;
  color: string; bg: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <div className={`p-2.5 rounded-xl ${bg} ${color} shrink-0`}>
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
