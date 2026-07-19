'use client';
import { useState, useEffect } from 'react';
import { Search, Bell, Plus, ChevronDown, Settings, LogOut,
         User, HelpCircle, Briefcase, Users, Building2, Keyboard, Mail, PenSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { clearToken, getToken, getTokenPayload } from '@/lib/auth';
import { useFetch } from '@/lib/useFetch';
import Link from 'next/link';

export function Topbar() {
  const router = useRouter();
  const [showProfile, setShowProfile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const { data: notifs } = useFetch<any>(mounted ? '/notifications/unread-count' : null);
  const unread = notifs?.unread || 0;

  useEffect(() => { setMounted(true); }, []);
  const _tok = mounted ? getTokenPayload() : null;
  const displayName = _tok?.full_name || 'Admin';
  const displayRole = (_tok?.role || 'admin').replace(/_/g,' ').replace(/\w/g, (c:string) => c.toUpperCase());
  const initials = displayName.split(' ').map((n:string) => n[0]).join('').slice(0,2).toUpperCase();

  const logout = async () => {
    try {
      const token = getToken();
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
      }
    } catch (_) {}
    clearToken();
    router.push('/login');
  };

  return (
    <header className="flex items-center px-6 gap-4 shrink-0" style={{
      height:'var(--topbar-h)', background:'white',
      borderBottom:'1px solid var(--gray-200)',
      boxShadow:'0 1px 0 var(--gray-100)',
    }}>
      {/* Global search */}
      <div className="search-bar flex-1" suppressHydrationWarning style={{ maxWidth:'480px' }}>
        <Search size={14} className="search-icon" />
        <input
          className="input"
          suppressHydrationWarning
          placeholder="Search candidates, jobs, companies, emails, LinkedIn URL..."
          value={search}
          onChange={e=>setSearch(e.target.value)}
          style={{ paddingLeft:'36px', borderRadius:'20px', background:'var(--gray-100)', border:'1px solid transparent' }}
        />
        {search && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5 rounded border" style={{ color:'var(--gray-400)', borderColor:'var(--gray-300)', fontSize:'10px' }}>
            ESC
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Compose email */}
        <a href="/conversations"
          title="Open Mailbox"
          style={{display:'flex',alignItems:'center',gap:'6px',padding:'6px 12px',
            background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'8px',
            color:'#1e40af',fontSize:'12px',fontWeight:'600',textDecoration:'none',cursor:'pointer'}}>
          <PenSquare size={13}/> <span style={{whiteSpace:'nowrap'}}>Compose</span>
        </a>
        {/* Quick add */}
        <div className="relative">
          <button onClick={()=>setShowAdd(!showAdd)}
            className="btn btn-primary btn-sm gap-1.5">
            <Plus size={14} /> New <ChevronDown size={12} />
          </button>
          {showAdd && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border z-50 py-1 anim-scale-in" style={{ borderColor:'var(--gray-200)' }}>
              {[
                { icon:<PenSquare size={14}/>, label:'Compose Mail',  href:'/conversations' },
                { icon:<Users size={14}/>, label:'Add Candidate',  href:'/candidates' },
                { icon:<Building2 size={14}/>, label:'Add Company', href:'/companies' },
                { icon:<Briefcase size={14}/>, label:'Add Job',    href:'/requisitions' },
              ].map(item => (
                <Link key={item.label} href={item.href} onClick={()=>setShowAdd(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                  style={{ color:'var(--gray-700)' }}>
                  <span style={{ color:'var(--primary)' }}>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Keyboard shortcuts */}
        <button className="btn btn-ghost btn-icon" title="Keyboard shortcuts">
          <Keyboard size={16} style={{ color:'var(--gray-400)' }} />
        </button>

        {/* Notifications */}
        <button className="btn btn-ghost btn-icon relative" title="Notifications">
          <Bell size={16} style={{ color:'var(--gray-500)' }} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 text-xs font-bold text-white rounded-full flex items-center justify-center" style={{ background:'var(--red)', fontSize:'9px' }}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* Settings */}
        <Link href="/settings/users" className="btn btn-ghost btn-icon" title="Settings">
          <Settings size={16} style={{ color:'var(--gray-400)' }} />
        </Link>

        {/* Profile */}
        <div className="relative">
          <button onClick={()=>setShowProfile(!showProfile)}
            className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors">
            <div className="avatar avatar-sm" style={{ background:'linear-gradient(135deg, var(--primary), var(--primary-light))' }}>
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold leading-tight" style={{ color:'var(--gray-800)' }}>{displayName}</div>
              <div className="text-xs leading-tight" style={{ color:'var(--gray-400)', fontSize:'10px' }}>{displayRole}</div>
            </div>
            <ChevronDown size={12} style={{ color:'var(--gray-400)' }} />
          </button>
          {showProfile && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border z-50 overflow-hidden anim-scale-in" style={{ borderColor:'var(--gray-200)' }}>
              <div className="px-4 py-3" style={{ background:'linear-gradient(135deg, var(--primary), var(--primary-light))' }}>
                <div className="font-semibold text-sm text-white">{displayName}</div>
                <div className="text-xs text-blue-200">{_tok?.email || ''}</div>
                <div className="text-xs mt-1 text-blue-200">AVIIN Jobs Services</div>
              </div>
              <div className="py-1">
                {[
                  { icon:<User size={14}/>,       label:'My Profile',     action:()=>{} },
                  { icon:<Mail size={14}/>,       label:'My Email Accounts', action:()=>router.push('/settings/mail-accounts') },
                  { icon:<PenSquare size={14}/>,  label:'Open Mailbox',      action:()=>router.push('/conversations') },
                  { icon:<Settings size={14}/>,    label:'Account Settings',action:()=>router.push('/settings/users') },
                  { icon:<HelpCircle size={14}/>,  label:'Help & Support', action:()=>{} },
                ].map(({ icon, label, action }) => (
                  <button key={label} onClick={()=>{ setShowProfile(false); action(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                    style={{ color:'var(--gray-700)' }}>
                    <span style={{ color:'var(--gray-400)' }}>{icon}</span>
                    {label}
                  </button>
                ))}
                <div className="border-t my-1" style={{ borderColor:'var(--gray-100)' }} />
                <button onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red-50 transition-colors"
                  style={{ color:'var(--red)' }}>
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
