'use client';
import Link from 'next/link';
import { getTokenPayload } from '@/lib/auth';
import { apiFetch } from '@/lib/useFetch';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  Inbox, LayoutDashboard, Users, Building2, Briefcase, KanbanSquare,
  Brain, Sparkles, TrendingUp,
  Calendar, FileText, BookOpen, Globe, Share2, ClipboardList,
  BarChart3, PieChart, AlertTriangle, Heart, Target,
  DollarSign, Wallet, Building, Crown, FileCheck, Gauge,
  Award, Handshake,
  Shield, FileSearch,
  Mail, MessageCircle, MessageSquare, Zap, Webhook,
  Truck, UserCog, Lock, BookMarked, Palette,
  ChevronDown, ChevronLeft, ChevronRight,
  FileSignature, Send, GitMerge, ExternalLink, Activity, Workflow,
  Users2, CalendarDays, Smile, Video, FileBarChart, UserPlus, Sliders,
  Laptop, KeyRound, MapPin, CalendarClock, HeartPulse, Bell,
} from 'lucide-react';

// REAL BUG FIX (2026-08-31): reported live off Settings > Permissions
// screenshots - unchecking a feature's grants for recruiter/kae/kam had
// ZERO effect on the sidebar, because it never consulted that data at
// all. This whole file's item/group visibility was driven purely by 2
// small, hardcoded, disconnected `roles:[...]` allowlists that predate
// the real, dynamic Permissions system (built 2026-08-17) and were never
// wired to it. Every item below now carries a real `feature:` key
// (mirroring `permissions.py`'s FEATURE_GROUPS 1:1, by the same design
// intent already documented there) - `hasFeatureAccess()` (below) checks
// the CURRENT USER's own role's real, live `read` grant for that key,
// fetched from GET /roles (already unrestricted to any authenticated
// user - no new backend endpoint needed). Items with no `feature:` key
// (Dashboard, and every My Account item) are deliberately exempt - a
// logged-in user must always be able to reach their own home page and
// their own account settings, matching how real-world RBAC UX always
// treats self-service items as separate from organizational data.
const NAV_GROUPS = [
  { id:'core', label:'CORE', defaultOpen:true, items:[
    { icon:LayoutDashboard, href:'/dashboard',    label:'Dashboard' },
    { icon:Bell,            href:'/reminders',    label:'Reminders & Follow-Ups', feature:'reminders' },
    { icon:Users,           href:'/candidates',   label:'Candidates', feature:'candidates' },
    { icon:Building2,       href:'/companies',    label:'Companies', feature:'companies' },
    { icon:Briefcase,       href:'/requisitions', label:'Jobs / Requisitions', feature:'requisitions' },
    { icon:KanbanSquare,    href:'/pipeline',     label:'Pipeline (Kanban)', feature:'pipeline' },
    { icon:TrendingUp,      href:'/pipeline-velocity',label:'Pipeline Velocity', feature:'pipeline_velocity' },
    { icon:GitMerge,        href:'/duplicates',   label:'Duplicate Candidates', feature:'duplicates' },
    { icon:Users2,          href:'/recruiter-ops', label:'Recruiter Ops', feature:'recruiter_ops' },
    { icon:ClipboardList,   href:'/assignments',   label:'Assignment Dashboard', feature:'assignment_dashboard' },
    { icon:Laptop,          href:'/device-monitoring', label:'Device Monitoring', feature:'device_monitoring' },
    { icon:MapPin,          href:'/field-attendance', label:'Field Attendance', feature:'field_attendance' },
    { icon:CalendarClock,   href:'/shift-scheduling', label:'Shift Scheduling', feature:'shift_scheduling' },
  ]},
  { id:'ai', label:'AI & INTELLIGENCE', defaultOpen:true, items:[
    { icon:Brain,           href:'/intelligence', label:'AI Intelligence', feature:'ai_intelligence' },
    { icon:Sparkles,        href:'/ai-tools',     label:'AI Tools', feature:'ai_tools' },
    { icon:TrendingUp,      href:'/predictions',  label:'Predictive Hiring', feature:'predictive_hiring' },
  ]},
  { id:'recruitment', label:'RECRUITMENT', defaultOpen:true, items:[
    { icon:Inbox,           href:'/resume-inbox',  label:'Resume Inbox', feature:'resume_inbox' },
    { icon:Calendar,        href:'/interviews',   label:'Interviews', feature:'interviews' },
    { icon:CalendarDays,    href:'/calendar',      label:'Calendar', feature:'calendar' },
    { icon:Video,           href:'/video-screening', label:'Video Screening', feature:'video_screening' },
    { icon:FileText,       href:'/offers',       label:'Offer Engine', feature:'offer_engine' },
    { icon:FileSignature,   href:'/nda-documents', label:'NDA Documents', feature:'nda_documents' },
    { icon:FileText,        href:'/jd-templates', label:'JD Templates', feature:'jd_templates' },
    { icon:Mail,            href:'/email-templates', label:'Email Templates', feature:'email_templates' },
    { icon:BookOpen,        href:'/question-bank',label:'Question Bank', feature:'question_bank' },
    { icon:FileCheck,       href:'/reference-checks', label:'Reference Checks', feature:'reference_checks' },
    { icon:FileBarChart,    href:'/submittals',   label:'Submittals', feature:'submittals' },
    { icon:Globe,           href:'/jobs',         label:'Job Board', feature:'job_board' },
    { icon:Share2,          href:'/job-sharing',  label:'Job Sharing', feature:'job_sharing' },
    { icon:ExternalLink,    href:'/careers',      label:'Career Page', external:true, feature:'career_page' },
    { icon:ClipboardList,   href:'/onboarding',   label:'Onboarding', feature:'onboarding' },
    { icon:Smile,           href:'/candidate-engagement', label:'Candidate Engagement', feature:'candidate_engagement' },
    { icon:UserPlus,        href:'/captured-profiles', label:'Captured Profiles', feature:'captured_profiles' },
  ]},
  { id:'analytics', label:'ANALYTICS', defaultOpen:false, items:[
    { icon:BarChart3,       href:'/analytics',        label:'Analytics', feature:'analytics' },
    { icon:PieChart,        href:'/reports',           label:'Reports', feature:'reports' },
    { icon:AlertTriangle,   href:'/sla',               label:'SLA Dashboard', feature:'sla_dashboard' },
    { icon:TrendingUp,      href:'/revenue-forecast',  label:'Revenue Forecast', feature:'revenue_forecast' },
    { icon:Heart,           href:'/client-health',     label:'Client Health', feature:'client_health' },
    { icon:Building2,       href:'/clients',           label:'Clients & Packs', feature:'clients_packs' },
    { icon:Target,          href:'/headcount',         label:'Headcount Plan', feature:'headcount_plan' },
    { icon:Activity,        href:'/command-center',    label:'War Room', feature:'war_room' },
    { icon:FileBarChart,    href:'/report-builder',    label:'Report Builder', feature:'report_builder' },
  ]},
  { id:'finance', label:'FINANCE', defaultOpen:false, items:[
    { icon:DollarSign,      href:'/finance',          label:'ERP / Finance', feature:'erp_finance' },
    { icon:BarChart3,       href:'/account-pl',       label:'Account P&L', feature:'account_pl' },
    { icon:Wallet,          href:'/collections',      label:'Collections', feature:'collections' },
    { icon:Building,        href:'/bu-tracker',       label:'BU Tracker', feature:'bu_tracker' },
    { icon:Crown,           href:'/ceo-dashboard',    label:'CEO Dashboard', feature:'ceo_dashboard' },
    { icon:FileCheck,       href:'/compliance',       label:'PF/ESI/TDS', feature:'compliance_pf_esi_tds' },
    { icon:Gauge,           href:'/salary-benchmark', label:'Salary Benchmark', feature:'salary_benchmark' },
  ]},
  { id:'incentives', label:'INCENTIVES & KAE', defaultOpen:false, items:[
    { icon:Award,           href:'/incentives',  label:'Incentives', feature:'incentives' },
    { icon:Handshake,       href:'/kae',         label:'KAE Module', feature:'kae' },
  ]},
  { id:'bgv', label:'BGV & COMPLIANCE', defaultOpen:false, items:[
    { icon:Shield,          href:'/bgv',   label:'BGV Checks', feature:'bgv_checks' },
    { icon:FileSearch,      href:'/audit', label:'Audit Log', feature:'audit_log' },
  ]},
  { id:'communication', label:'COMMUNICATION', defaultOpen:false, items:[
    { icon:Mail,            href:'/conversations', label:'Email / Conversations', feature:'email_communication' },
    { icon:BarChart3,       href:'/email-reports', label:'Email Reports & Analytics', feature:'email_reports' },
    { icon:MessageCircle,   href:'/whatsapp',      label:'WhatsApp Bot', feature:'whatsapp_bot' },
    { icon:Send,            href:'/whatsapp?tab=stage-notifications', label:'WhatsApp Stage Notifications', feature:'whatsapp_stage_notifications' },
    { icon:Globe,            href:'/whatsapp-setup', label:'Company WhatsApp Number', feature:'whatsapp_setup' },
    { icon:MessageSquare,   href:'/sms',           label:'SMS Notifications', feature:'sms_notifications' },
    { icon:Zap,             href:'/automations',   label:'Automations', feature:'automations' },
    { icon:Workflow,        href:'/nurture',       label:'Nurture Sequences', feature:'nurture_sequences' },
    { icon:Webhook,         href:'/integrations',  label:'Integrations', feature:'integrations' },
  ]},
  { id:'vendors', label:'VENDORS', defaultOpen:false, items:[
    { icon:Truck,           href:'/vendor-analytics', label:'Vendor Analytics', feature:'vendor_analytics' },
    { icon:UserPlus,        href:'/agency-portal',    label:'Agency Portal', feature:'agency_portal' },
  ]},
  { id:'settings', label:'SETTINGS', defaultOpen:false, items:[
    { icon:UserCog,         href:'/settings/users',       label:'Users & Roles', feature:'users_roles' },
    { icon:KeyRound,        href:'/settings/permissions', label:'Permissions', roles:['admin','super_admin'] },
    { icon:KanbanSquare,    href:'/settings/pipeline',    label:'Pipeline Stages', feature:'pipeline_stages' },
    { icon:Mail,            href:'/settings/email',           label:'Company Email (SMTP)', feature:'company_email_smtp' },
    { icon:MessageSquare,   href:'/settings/signatures',       label:'Email Signatures', feature:'email_signatures' },
    { icon:Lock,            href:'/security',             label:'Security / 2FA', feature:'security_2fa' },
    { icon:BookMarked,      href:'/settings/skills',      label:'Skills Taxonomy', feature:'skills_taxonomy' },
    { icon:Palette,         href:'/themes',               label:'6 Themes', feature:'themes' },
    { icon:Sliders,         href:'/ops-settings',         label:'Ops Settings', feature:'ops_settings' },
  ]},
  { id:'my_account', label:'MY ACCOUNT', defaultOpen:true, items:[
    { icon:Mail,            href:'/settings/mail-accounts', label:'My Email Accounts' },
    { icon:MessageCircle,   href:'/settings/whatsapp-account', label:'My WhatsApp Account' },
    { icon:MessageSquare,   href:'/settings/signatures',     label:'Email Signatures' },
    { icon:MessageSquare,   href:'/conversations',           label:'My Mailbox' },
    { icon:UserCog,         href:'/profile',                 label:'My Profile' },
  ]},
];

interface SidebarProps {
  // Real mobile-responsiveness fix (2026-09-02) — see the media-query
  // block below for why this is CSS-driven rather than JS-viewport-
  // driven (avoids a first-paint flash of the full desktop sidebar on
  // a real phone). `mobileOpen` only controls whether the drawer is
  // currently pulled into view; the closed-by-default position itself
  // is a plain CSS rule that applies before any JS runs.
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps = {}) {
  // usePathname auto-updates on every navigation change
  const pathname = usePathname() || '';

  const [collapsed, setCollapsed] = useState(false);
  const [_mounted2, set_Mounted2] = useState(false);
  useEffect(() => { set_Mounted2(true); }, []);
  const userRole = _mounted2 ? (getTokenPayload()?.role || 'admin') : 'admin';
  const [openGroups, setOpenGroups] = useState<Record<string,boolean>>(
    () => Object.fromEntries(NAV_GROUPS.map(g => [g.id, g.defaultOpen]))
  );

  // Real permission grants for the current user's own role — fetched once
  // after mount (GET /roles is unrestricted to any authenticated user,
  // already returns every role's real permissions dict; no new endpoint
  // needed). `null` = "not yet loaded" (show everything, avoids an empty
  // sidebar flash on first paint) and is also the real server-side
  // semantics for "this role has no role_definitions row at all" — both
  // cases mean "don't gate," matching require_permission()'s own
  // documented default in backend/permissions.py.
  const [rolePerms, setRolePerms] = useState<Record<string, string[]> | null>(null);
  useEffect(() => {
    if (!_mounted2 || ['admin','super_admin'].includes(userRole)) return;
    let cancelled = false;
    apiFetch('/roles').then((rows: any[]) => {
      if (cancelled) return;
      const mine = (rows || []).find(r => r.role_code === userRole);
      setRolePerms(mine ? (mine.permissions || {}) : null);
    }).catch(() => { if (!cancelled) setRolePerms(null); });
    return () => { cancelled = true; };
  }, [_mounted2, userRole]);

  // Mirrors backend/permissions.py's check_permission() exactly: no
  // permissions loaded (admin, or not fetched yet) → allow; a real "*"
  // wildcard on the action → allow; otherwise the feature's own action
  // list must contain "*" or the specific action.
  const hasFeatureAccess = (feature?: string, action = 'read') => {
    if (!feature || rolePerms === null || ['admin','super_admin'].includes(userRole)) return true;
    const wildcard = rolePerms['*'];
    if (wildcard && (wildcard.includes('*') || wildcard.includes(action))) return true;
    const acts = rolePerms[feature];
    if (!acts) return false;
    return acts.includes('*') || acts.includes(action);
  };

  // Combines the small number of genuinely hard role-restricted items
  // (e.g. Settings > Permissions, always admin-only regardless of the
  // matrix) with the real, dynamic per-feature check above.
  const itemVisible = (item: any) => {
    if (item.roles && (!_mounted2 || !item.roles.includes(userRole))) return false;
    return hasFeatureAccess(item.feature);
  };

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

  // Mobile drawer: auto-close on navigation. Unconditional and harmless
  // on desktop — setting an already-false `mobileOpen` back to false via
  // onClose() is a React no-op, so no separate viewport check is needed
  // here either (matches the same "let CSS gate the visual effect, keep
  // JS state simple" principle used throughout this fix).
  useEffect(() => { onClose?.(); }, [pathname]);

  // Mobile drawer: lock background scroll while open — mirrors the
  // exact, already-established pattern from Modal.tsx (document.body.
  // style.overflow toggled, restored on unmount/close).
  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

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
      {/* ── Mobile backdrop — only ever visually appears below the
          767px media-query breakpoint (see the <style> block below);
          harmless on desktop even in an unexpected state, since it
          carries no position/background of its own outside that
          media query. ── */}
      {mobileOpen && (
        <div className="aviin-sidebar-backdrop" onClick={onClose} />
      )}

      {/* ── Main sidebar panel ── */}
      <div className={`aviin-sidebar-panel${mobileOpen ? ' mobile-open' : ''}`} style={{
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
          {_mounted2 ? NAV_GROUPS.filter(group =>
            // A group renders only if at least one of its own items would
            // (real permission grant, or a role-restricted item this role
            // is allowed, or a self-service item with no gate at all).
            group.items.some(itemVisible)
          ).map(group => {
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
                  {group.items.filter(itemVisible).map(item => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        target={(item as any).external ? '_blank' : undefined}
                        rel={(item as any).external ? 'noopener noreferrer' : undefined}
                        title={collapsed ? item.label : (item as any).external ? `${item.label} (opens in new tab)` : undefined}
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

      {/* ── Toggle tab — visible on the right edge on desktop; hidden
          below the 767px breakpoint via the aviin-sidebar-collapse-
          toggle class (the mobile drawer is opened/closed via the
          hamburger + backdrop instead, not this manual collapse
          toggle). ── */}
      <button
        className="aviin-sidebar-collapse-toggle"
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

      {/* Real mobile-responsiveness fix (2026-09-02) — CSS media query
          is the authoritative responsive mechanism here, not JS viewport
          detection, specifically to avoid a first-paint flash: a
          useEffect-based window.innerWidth check can't run before the
          browser's first paint, so on a real phone that would mean one
          visible frame of the full, un-drawered desktop sidebar before
          JS "snaps" it closed. This rule applies before any JS runs at
          all, so the drawer is correctly closed-by-default from the very
          first paint. Matches the established inline <style> pattern
          already used in GlobalSearch.tsx for its own spin-keyframes -
          not a new idiom for this codebase. */}
      <style>{`
        @media (max-width: 767px) {
          .aviin-sidebar-panel {
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            width: 220px !important;
            z-index: 200;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            box-shadow: 4px 0 24px rgba(0,0,0,0.25);
          }
          .aviin-sidebar-panel.mobile-open {
            transform: translateX(0);
          }
          .aviin-sidebar-collapse-toggle {
            display: none;
          }
          .aviin-sidebar-backdrop {
            position: fixed;
            inset: 0;
            z-index: 199;
            background: rgba(15,23,42,0.5);
          }
        }
      `}</style>
    </div>
  );
}
