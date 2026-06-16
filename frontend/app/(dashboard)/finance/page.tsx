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
  id: string;
  candidate_name: string;
  client_name: string;
  req_title: string;
  start_date: string;
  end_date: string | null;
  bill_rate: number | null;
  pay_rate: number | null;
  status: string;
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

      {/* Timesheets tab — P12 stub */}
      {tab === 'timesheets' && (
        <Card data-testid="timesheets-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Timesheet Management</h2>
            <p className="text-xs text-gray-400 mt-0.5">Weekly timesheet submission · approval workflow</p>
          </CardHeader>
          <CardContent>
            <P12Stub feature="Timesheet Management" description="Submit, review, and approve weekly contractor timesheets with auto-calculation of billable hours." />
          </CardContent>
        </Card>
      )}

      {/* Invoices tab — P12 stub */}
      {tab === 'invoices' && (
        <Card data-testid="invoices-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Invoice Generation</h2>
            <p className="text-xs text-gray-400 mt-0.5">Auto-generate and track client invoices from approved timesheets</p>
          </CardHeader>
          <CardContent>
            <P12Stub feature="Invoice Generation" description="Automated invoice creation from approved timesheets, with GST support and client payment tracking." />
          </CardContent>
        </Card>
      )}

      {/* Payroll tab — P12 stub */}
      {tab === 'payroll' && (
        <Card data-testid="payroll-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Contractor Payroll</h2>
            <p className="text-xs text-gray-400 mt-0.5">Pay contractor earnings from collected invoice receipts</p>
          </CardHeader>
          <CardContent>
            <P12Stub feature="Payroll Processing" description="Process contractor payments with TDS deductions, PF contributions, and auto-generated payslips. Aadhaar/PAN fields encrypted at rest (HARD RULE #11)." />
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

function P12Stub({ feature, description }: { feature: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-gray-400">
      <div className="p-4 rounded-2xl bg-[--color-surface-alt]">
        <FileText className="h-12 w-12 text-gray-300" />
      </div>
      <div className="text-center max-w-sm">
        <p className="text-sm font-semibold text-gray-600">{feature} — Coming in P12</p>
        <p className="text-xs text-gray-400 mt-2">{description}</p>
      </div>
      <span className="text-xs px-3 py-1 bg-[--color-surface-alt] text-gray-500 rounded-full font-medium">
        Planned · ERP Phase 12
      </span>
    </div>
  );
}
