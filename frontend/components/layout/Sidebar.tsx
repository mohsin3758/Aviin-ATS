'use client';
import Link from 'next/link';
import { getTokenPayload } from '@/lib/auth';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  Inbox, LayoutDashboard, Users, Building2, Briefcase, KanbanSquare,
  Brain, Sparkles, TrendingUp, ClipboardCheck,
  Calendar, FileText, BookOpen, Globe, Share2, ClipboardList,
  BarChart3, PieChart, AlertTriangle, Heart, Target,
  DollarSign, Wallet, Building, Crown, FileCheck, Gauge,
  Award, Handshake,
  Shield, FileSearch,
  Mail, MessageCircle, MessageSquare, Zap, Webhook,
  Truck, UserCog, Lock, BookMarked, Palette,
  ChevronDown, ChevronLeft, ChevronRight,
  FileSignature, Send, GitMerge,
} from 'lucide-react';

const NAV_GROUPS = [
  { id:'core', label:'CORE', defaultOpen:true, items:[
    { icon:LayoutDashboard, href:'/dashboard',    label:'Dashboard' },
    { icon:Users,           href:'/candidates',   label:'Candidates' },
    { icon:Building2,       href:'/companies',    label:'Companies', roles:['admin','super_admin','kae','kae_manager','lead_recruiter'] },
    { icon:Briefcase,       href:'/requisitions', label:'Jobs / Requisitions', roles:['admin','super_admin','kae','kae_manager','lead_recruiter'] },
    { icon:KanbanSquare,    href:'/pipeline',     label:'Pipeline (Kanban)' },
    { icon:TrendingUp,      href:'/pipeline-velocity',label:'Pipeline Velocity', roles:['admin','super_admin','lead_recruiter'] },
    { icon:GitMerge,        href:'/duplicates',   label:'Duplicate Candidates' },
  ]},
  { id:'ai', label:'AI & INTELLIGENCE', defaultOpen:true, items:[
    { icon:Brain,           href:'/intelligence', label:'AI Intelligence' },
    { icon:Sparkles,        href:'/ai-tools',     label:'AI Tools' },
    { icon:TrendingUp,      href:'/predictions',  label:'Predictive Hiring' },
    { icon:ClipboardCheck,  href:'/assessments',  label:'Assessments' },
  ]},
  { id:'recruitment', label:'RECRUITMENT', defaultOpen:true, items:[
    { icon:Inbox,           href:'/resume-inbox',  label:'Resume Inbox' },
    { icon:Calendar,        href:'/interviews',   label:'Interviews' },
    { icon:FileText,       href:'/offers',       label:'Offer Engine' },
    { icon:FileSignature,   href:'/nda-documents', label:'NDA Documents' },
    { icon:FileText,        href:'/jd-templates', label:'JD Templates' },
    { icon:BookOpen,        href:'/question-bank',label:'Question Bank' },
    { icon:Globe,           href:'/jobs',         label:'Job Board' },
    { icon:Share2,          href:'/job-sharing',  label:'Job Sharing' },
    { icon:ClipboardList,   href:'/onboarding',   label:'Onboarding' },
  ]},
  { id:'analytics', label:'ANALYTICS', defaultOpen:false, items:[
    { icon:BarChart3,       href:'/analytics',        label:'Analytics' },
    { icon:PieChart,        href:'/reports',           label:'Reports' },
    { icon:AlertTriangle,   href:'/sla',               label:'SLA Dashboard' },
    { icon:TrendingUp,      href:'/revenue-forecast',  label:'Revenue Forecast' },
    { icon:Heart,           href:'/client-health',     label:'Client Health' },
    { icon:Building2,       href:'/clients',           label:'Clients & Packs' },
    { icon:Target,          href:'/headcount',         label:'Headcount Plan' },
  ]},
  { id:'finance', label:'FINANCE', defaultOpen:false, items:[
    { icon:DollarSign,      href:'/finance',          label:'ERP / Finance' },
    { icon:BarChart3,       href:'/account-pl',       label:'Account P&L' },
    { icon:Wallet,          href:'/collections',      label:'Collections' },
    { icon:Building,        href:'/bu-tracker',       label:'BU Tracker' },
    { icon:Crown,           href:'/ceo-dashboard',    label:'CEO Dashboard' },
    { icon:FileCheck,       href:'/compliance',       label:'PF/ESI/TDS' },
    { icon:Gauge,           href:'/salary-benchmark', label:'Salary Benchmark' },
  ]},
  { id:'incentives', label:'INCENTIVES & KAE', defaultOpen:false, items:[
    { icon:Award,           href:'/incentives',  label:'Incentives' },
    { icon:Handshake,       href:'/kae',         label:'KAE Module' },
  ]},
  { id:'bgv', label:'BGV & COMPLIANCE', defaultOpen:false, items:[
    { icon:Shield,          href:'/bgv',   label:'BGV Checks' },
    { icon:FileSearch,      href:'/audit', label:'Audit Log' },
  ]},
  { id:'communication', label:'COMMUNICATION', defaultOpen:false, items:[
    { icon:Mail,            href:'/conversations', label:'Email / Conversations' },
    { icon:MessageCircle,   href:'/whatsapp',      label:'WhatsApp Bot' },
    { icon:Send,            href:'/whatsapp?tab=stage-notifications', label:'WhatsApp Stage Notifications' },
    { icon:Globe,            href:'/whatsapp-setup', label:'WhatsApp Setup' },
    { icon:MessageSquare,   href:'/sms',           label:'SMS Notifications' },
    { icon:Zap,             href:'/automations',   label:'Automations' },
    { icon:Webhook,         href:'/integrations',  label:'Integrations' },
  ]},
  { id:'vendors', label:'VENDORS', defaultOpen:false, items:[
    { icon:Truck,           href:'/vendor-analytics', label:'Vendor Analytics' },
  ]},
  { id:'settings', label:'SETTINGS', defaultOpen:false, items:[
    { icon:UserCog,         href:'/settings/users',       label:'Users & Roles' },
    { icon:KanbanSquare,    href:'/settings/pipeline',    label:'Pipeline Stages' },
    { icon:Mail,            href:'/settings/email',           label:'Company Email (SMTP)' },
    { icon:MessageSquare,   href:'/settings/signatures',       label:'Email Signatures', roles:['admin','lead_recruiter','recruiter','delivery','kae','kae_manager'] },
    { icon:Lock,            href:'/security',             label:'Security / 2FA' },
    { icon:BookMarked,      href:'/settings/skills',      label:'Skills Taxonomy' },
    { icon:Palette,         href:'/themes',               label:'6 Themes' },
  ]},
  { id:'my_account', label:'MY ACCOUNT', defaultOpen:true, items:[
    { icon:Mail,            href:'/settings/mail-accounts', label:'My Email Accounts' },
    { icon:MessageSquare,   href:'/settings/signatures',     label:'Email Signatures' },
    { icon:MessageSquare,   href:'/conversations',           label:'My Mailbox' },
    { icon:UserCog,         href:'/profile',                 label:'My Profile' },
  ]},
];

export function Sidebar() {
  // usePathname auto-updates on every navigation change
  const pathname = usePathname() || '';

  const [collapsed, setCollapsed] = useState(false);
  const [_mounted2, set_Mounted2] = useState(false);
  useEffect(() => { set_Mounted2(true); }, []);
  const userRole = _mounted2 ? (getTokenPayload()?.role || 'admin') : 'admin';
  const isAdmin = ['admin','super_admin'].includes(userRole);
  const isLead = ['admin','super_admin','lead_recruiter'].includes(userRole);
  const [openGroups, setOpenGroups] = useState<Record<string,boolean>>(
    () => Object.fromEntries(NAV_GROUPS.map(g => [g.id, g.defaultOpen]))
  );

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

  // Auto-open group containing active page
  useEffect(() => {
    // no-op: usePathname handles updates
  }, []);
  useEffect(() => {
    NAV_GROUPS.forEach(group => {
      if (group.items.some(item => isActive(item.href))) {
        setOpenGroups(prev => ({ ...prev, [group.id]: true }));
      }
    });
  }, [pathname]);

  const toggleGroup = (id: string) => {
    if (collapsed) return;
    setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      flexShrink: 0,
      position: 'relative',
    }}>
      {/* ── Main sidebar panel ── */}
      <div style={{
        width: collapsed ? '52px' : '220px',
        background: '#0f172a',
        minHeight: '100vh',
        transition: 'width 0.25s ease',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.07)',
      }}>
        {/* Logo */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: collapsed ? '13px 10px' : '13px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: '10px',
          flexShrink: 0,
          minHeight: '56px',
        }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '8px',
            background: '#00b87c', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '14px', fontWeight: '800',
            color: 'white', flexShrink: 0,
          }}>A</div>
          {!collapsed && (
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '13px', fontWeight: '800', color: 'white', whiteSpace: 'nowrap' }}>AVIIN ATS</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>AI Staffing OS</div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 6px 16px', }} suppressHydrationWarning>
          {_mounted2 ? NAV_GROUPS.filter(group => {
            // Role-based sidebar filtering
            if (userRole === 'recruiter' || userRole === 'delivery') {
              return ['core','recruitment','ai','communication','my_account'].includes(group.id);
            }
            if (userRole === 'kae' || userRole === 'kae_manager') {
              return ['core','recruitment','finance','settings','communication','my_account'].includes(group.id);
            }
            if (userRole === 'lead_recruiter') {
              return !['finance','incentives','vendors'].includes(group.id);
            }
            return true; // admin/super_admin see everything
          }).map(group => {
            const isOpen = openGroups[group.id];
            const hasActive = group.items.some(item => isActive(item.href));

            return (
              <div key={group.id} style={{ marginBottom: '2px' }} suppressHydrationWarning>
                {/* Group header — only show when expanded */}
                {!collapsed && (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '5px 8px', borderRadius: '6px',
                      border: 'none', cursor: 'pointer',
                      background: 'transparent', marginBottom: '2px',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <span style={{
                      fontSize: '10px', fontWeight: '700',
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: hasActive ? '#00b87c' : 'rgba(255,255,255,0.3)',
                    }}>
                      {group.label}
                    </span>
                    <ChevronDown
                      size={11}
                      style={{
                        color: hasActive ? '#00b87c' : 'rgba(255,255,255,0.25)',
                        transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                        transition: 'transform 0.2s ease',
                        flexShrink: 0,
                      }}
                    />
                  </button>
                )}

                {/* Dot separator in collapsed mode */}
                {collapsed && (
                  <div style={{
                    display: 'flex', justifyContent: 'center', padding: '5px 0 3px',
                  }}>
                    <div style={{
                      width: '4px', height: '4px', borderRadius: '50%',
                      background: hasActive ? '#00b87c' : 'rgba(255,255,255,0.15)',
                    }} />
                  </div>
                )}

                {/* Items */}
                <div suppressHydrationWarning style={{
                  overflow: 'hidden',
                  maxHeight: collapsed ? '1000px' : (isOpen ? '600px' : '0px'),
                  transition: collapsed ? 'none' : 'max-height 0.22s ease',
                }}>
                  {group.items.filter((item:any) => {
                    if (!item.roles) return true;
                    // Only filter AFTER client is mounted (prevents hydration mismatch)
                    if (!_mounted2) return true;
                    return item.roles.includes(userRole);
                  }).map(item => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        style={{
                          display: 'flex', alignItems: 'center',
                          gap: collapsed ? '0' : '9px',
                          padding: collapsed ? '8px 0' : '6px 8px 6px 10px',
                          borderRadius: '7px', marginBottom: '1px',
                          textDecoration: 'none',
                          background: active ? 'rgba(0,184,124,0.14)' : 'transparent',
                          borderLeft: !collapsed ? (active ? '2px solid #00b87c' : '2px solid transparent') : 'none',
                          justifyContent: collapsed ? 'center' : 'flex-start',
                          transition: 'background 0.12s',
                        }}
                        onMouseEnter={e => {
                          if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                        }}
                        onMouseLeave={e => {
                          if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
                        }}
                      >
                        <item.icon
                          size={15}
                          strokeWidth={active ? 2.2 : 1.7}
                          style={{
                            color: active ? '#00b87c' : 'rgba(255,255,255,0.5)',
                            flexShrink: 0,
                          }}
                        />
                        {!collapsed && (
                          <span style={{
                            fontSize: '12.5px',
                            fontWeight: active ? '600' : '400',
                            color: active ? '#fff' : 'rgba(255,255,255,0.65)',
                            whiteSpace: 'nowrap', overflow: 'hidden',
                            textOverflow: 'ellipsis', flex: 1,
                          }}>
                            {item.label}
                          </span>
                        )}
                        {active && !collapsed && (
                          <div style={{
                            width: '5px', height: '5px', borderRadius: '50%',
                            background: '#00b87c', flexShrink: 0,
                          }} />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }) : null}
        </div>

        {/* Version footer */}
        {!collapsed && (
          <div style={{
            padding: '8px 14px', fontSize: '10px',
            color: 'rgba(255,255,255,0.18)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            AVIIN ATS v2.0 · 149 Features
          </div>
        )}
      </div>

      {/* ── Toggle tab — ALWAYS VISIBLE on the right edge ── */}
      <button
        onClick={() => setCollapsed(prev => !prev)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          position: 'absolute',
          right: '-14px',
          top: '16px',
          transform: 'none',
          zIndex: 50,
          width: '16px',
          height: '36px',
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.12)',
          borderLeft: 'none',
          borderRadius: '0 6px 6px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
          padding: 0,
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#2d3f56'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#1e293b'}
      >
        {collapsed
          ? <ChevronRight size={10} style={{ color: 'rgba(255,255,255,0.6)' }} />
          : <ChevronLeft  size={10} style={{ color: 'rgba(255,255,255,0.6)' }} />
        }
      </button>
    </div>
  );
}
