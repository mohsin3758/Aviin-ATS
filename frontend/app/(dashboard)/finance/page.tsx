'use client';

import { useState } from 'react';
import {
  DollarSign, Users, TrendingUp, Clock, AlertTriangle,
  FileText, CreditCard, Wallet,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch } from '@/lib/useFetch';

type FinTab = 'contractors' | 'timesheets' | 'invoices' | 'payroll';

interface Placement {
  id: string; candidate_name: string; client_name: string; req_title: string;
  start_date: string; end_date: string | null; bill_rate: number | null;
  pay_rate: number | null; status: string;
}

interface Timesheet {
  id: string; placement_id: string; candidate_id: string;
  candidate_name: string; client_name: string | null;
  week_start: string; week_end: string; regular_hours: number;
  overtime_hours: number; total_hours: number; status: string;
  submitted_at: string | null; approved_at: string | null;
}

interface Invoice {
  id: string; invoice_number: string; invoice_date: string; due_date: string;
  subtotal: number; gst_amount: number; total_amount: number;
  status: string; paid_at: string | null; client_name: string;
}

interface PayrollRun {
  id: string; pay_period_start: string; pay_period_end: string; status: string;
  total_gross: number; total_tds: number; total_pf: number; total_net: number;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  ending_soon: 'bg-amber-100 text-amber-700',
  ended: 'bg-gray-100 text-gray-500',
  converted_fte: 'bg-blue-100 text-blue-700',
};

const TABS: { key: FinTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'contractors', label: 'Contractors', icon: Users },
  { key: 'timesheets', label: 'Timesheets', icon: Clock },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'payroll', label: 'Payroll', icon: CreditCard },
];

function fmt(n: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export default function FinancePage() {
  const [tab, setTab] = useState<FinTab>('contractors');
  const { data: placements, loading } = useFetch<Placement[]>('/analytics/active-placements');
  const { data: timesheets, loading: tsLoading, refetch: refetchTs } =
    useFetch<Timesheet[]>(tab === 'timesheets' ? '/erp/timesheets' : null);
  const { data: invoices, loading: invLoading } =
    useFetch<Invoice[]>(tab === 'invoices' ? '/erp/invoices' : null);
  const { data: payrollRuns, loading: prLoading, refetch: refetchPr } =
    useFetch<PayrollRun[]>(tab === 'payroll' ? '/erp/payroll-runs' : null);

  const active = placements?.filter(p => p.status === 'active') ?? [];
  const endingSoon = placements?.filter(p => p.status === 'ending_soon') ?? [];

  const totalMonthlyBill = active.reduce((s, p) => s + (p.bill_rate ?? 0), 0);
  const totalMonthlyPay = active.reduce((s, p) => s + (p.pay_rate ?? 0), 0);
  const grossMargin = totalMonthlyBill - totalMonthlyPay;
  const marginPct = totalMonthlyBill > 0 ? Math.round((grossMargin / totalMonthlyBill) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[--color-primary]/10">
          <Wallet className="h-5 w-5 text-[--color-primary]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">T6 Finance ERP</h1>
          <p className="text-sm text-gray-500">Contractor billing · timesheet · payroll overview</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="finance-kpis">
        <FinKPI
          icon={Users}
          label="Active Contractors"
          value={loading ? null : active.length}
          color="text-blue-600" bg="bg-blue-50"
        />
        <FinKPI
          icon={DollarSign}
          label="Monthly Bill (INR)"
          value={loading ? null : fmt(totalMonthlyBill)}
          color="text-green-600" bg="bg-green-50"
        />
        <FinKPI
          icon={TrendingUp}
          label={`Gross Margin ${marginPct ? `(${marginPct}%)` : ''}`}
          value={loading ? null : fmt(grossMargin)}
          color="text-purple-600" bg="bg-purple-50"
        />
        <FinKPI
          icon={AlertTriangle}
          label="Ending Soon"
          value={loading ? null : endingSoon.length}
          color="text-amber-600" bg="bg-amber-50"
        />
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-tab={t.key}
            className={[
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2',
              tab === t.key
                ? 'border-[--color-primary] text-[--color-primary]'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Contractors tab */}
      {tab === 'contractors' && (
        <Card data-testid="contractors-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Contractor Billing Grid</h2>
            <p className="text-xs text-gray-400 mt-0.5">Active contractor engagements · bill rate vs pay rate</p>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Contractor</Th>
                    <Th>Client</Th>
                    <Th>Role</Th>
                    <Th>Start</Th>
                    <Th>End</Th>
                    <Th>Bill/Mo</Th>
                    <Th>Pay/Mo</Th>
                    <Th>Margin</Th>
                    <Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!placements || placements.length === 0) ? (
                    <Tr>
                      <Td colSpan={9} className="text-center text-gray-400 py-10 text-sm">
                        No placements found
                      </Td>
                    </Tr>
                  ) : placements.map(p => {
                    const margin = (p.bill_rate ?? 0) - (p.pay_rate ?? 0);
                    return (
                      <Tr key={p.id}>
                        <Td className="font-medium text-gray-800">{p.candidate_name}</Td>
                        <Td className="text-gray-600 text-sm">{p.client_name}</Td>
                        <Td className="text-gray-500 text-xs max-w-[160px] truncate">{p.req_title}</Td>
                        <Td className="text-xs text-gray-500">{p.start_date}</Td>
                        <Td className="text-xs text-gray-500">{p.end_date ?? '—'}</Td>
                        <Td className="text-sm font-medium text-gray-800">{fmt(p.bill_rate)}</Td>
                        <Td className="text-sm text-gray-600">{fmt(p.pay_rate)}</Td>
                        <Td>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            margin > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {fmt(margin)}
                          </span>
                        </Td>
                        <Td>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                            {p.status.replace('_', ' ')}
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Timesheets tab — real ERP data (P12) */}
      {tab === 'timesheets' && (
        <Card data-testid="timesheets-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Clock className="h-4 w-4" /> Timesheet Management
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Weekly timesheets · draft → submitted → approved → billed
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {tsLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Contractor</Th><Th>Client</Th><Th>Week</Th>
                    <Th>Reg hrs</Th><Th>OT hrs</Th><Th>Total</Th><Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!timesheets || timesheets.length === 0) ? (
                    <Tr><Td colSpan={7} className="text-center text-gray-400 py-10 text-sm">
                      No timesheets yet. Create via <code className="text-xs bg-gray-100 px-1 rounded">POST /erp/timesheets</code>
                    </Td></Tr>
                  ) : timesheets.map(ts => (
                    <Tr key={ts.id}>
                      <Td className="font-medium text-gray-800">{ts.candidate_name}</Td>
                      <Td className="text-sm text-gray-600">{ts.client_name ?? '—'}</Td>
                      <Td className="text-xs text-gray-500">{ts.week_start} – {ts.week_end}</Td>
                      <Td>{ts.regular_hours}h</Td>
                      <Td>{ts.overtime_hours}h</Td>
                      <Td className="font-medium">{ts.total_hours}h</Td>
                      <Td>
                        <TsStatusBadge status={ts.status} />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invoices tab — real ERP data (P12) */}
      {tab === 'invoices' && (
        <Card data-testid="invoices-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="h-4 w-4" /> Invoice Management
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Auto-generated from approved timesheets · GST 18% included
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {invLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Invoice #</Th><Th>Client</Th><Th>Date</Th>
                    <Th>Subtotal</Th><Th>GST</Th><Th>Total</Th><Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!invoices || invoices.length === 0) ? (
                    <Tr><Td colSpan={7} className="text-center text-gray-400 py-10 text-sm">
                      No invoices yet. Approve timesheets then call <code className="text-xs bg-gray-100 px-1 rounded">POST /erp/invoices/generate</code>
                    </Td></Tr>
                  ) : invoices.map(inv => (
                    <Tr key={inv.id}>
                      <Td className="font-mono text-xs font-medium text-gray-800">{inv.invoice_number}</Td>
                      <Td className="text-sm text-gray-700">{inv.client_name}</Td>
                      <Td className="text-xs text-gray-500">{inv.invoice_date}</Td>
                      <Td>{fmt(inv.subtotal)}</Td>
                      <Td className="text-gray-500 text-sm">{fmt(inv.gst_amount)}</Td>
                      <Td className="font-semibold text-gray-900">{fmt(inv.total_amount)}</Td>
                      <Td>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                          inv.status === 'overdue' ? 'bg-red-100 text-red-700' :
                          inv.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>{inv.status}</span>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payroll tab — real ERP data (P12) */}
      {tab === 'payroll' && (
        <Card data-testid="payroll-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Payroll Runs
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              TDS 10% + PF 12% auto-deducted · Aadhaar/PAN encrypted at rest (HARD RULE #11)
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {prLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Pay Period</Th><Th>Gross</Th><Th>TDS</Th><Th>PF</Th><Th>Net</Th><Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!payrollRuns || payrollRuns.length === 0) ? (
                    <Tr><Td colSpan={6} className="text-center text-gray-400 py-10 text-sm">
                      No payroll runs yet. Call <code className="text-xs bg-gray-100 px-1 rounded">POST /erp/payroll-runs</code> to generate from approved timesheets
                    </Td></Tr>
                  ) : payrollRuns.map(pr => (
                    <Tr key={pr.id}>
                      <Td className="text-xs text-gray-700">{pr.pay_period_start} – {pr.pay_period_end}</Td>
                      <Td>{fmt(pr.total_gross)}</Td>
                      <Td className="text-red-600 text-sm">-{fmt(pr.total_tds)}</Td>
                      <Td className="text-blue-600 text-sm">-{fmt(pr.total_pf)}</Td>
                      <Td className="font-semibold text-green-700">{fmt(pr.total_net)}</Td>
                      <Td>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          pr.status === 'paid' ? 'bg-green-100 text-green-700' :
                          pr.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>{pr.status}</span>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FinKPI({
  icon: Icon, label, value, color, bg,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string | number | null;
  color: string; bg: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <div className={`p-2.5 rounded-xl ${bg} ${color} shrink-0`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-gray-900 truncate">
            {value === null ? <Spinner size="sm" /> : value}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TsStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-500',
    submitted: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    billed: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}
