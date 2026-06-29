'use client';
import { useState, type FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { login } from '@/lib/auth';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams?.get('reason') === 'session_expired';
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(''); setLoading(true);
    try {
      await login(fd.get('email') as string, fd.get('password') as string);
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally { setLoading(false); }
  }

  const INP: React.CSSProperties = {
    width: '100%', padding: '11px 14px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px', fontSize: '14px', color: 'white',
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f172a 100%)', padding:'20px', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif' }}>
      <div style={{ width:'100%', maxWidth:'400px' }}>

        {/* Logo + Brand */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:'32px', gap:'12px' }}>
          <div style={{ width:'68px', height:'68px', borderRadius:'18px', background:'linear-gradient(135deg,#00b87c,#00a36e)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 8px 32px rgba(0,184,124,0.45)' }}>
            <span style={{ fontSize:'32px', fontWeight:'900', color:'white', lineHeight:1 }}>A</span>
          </div>
          <div style={{ textAlign:'center' }}>
            <h1 style={{ fontSize:'24px', fontWeight:'800', color:'white', margin:0, letterSpacing:'-0.5px' }}>AVIIN ATS</h1>
            <p style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', margin:'4px 0 0', letterSpacing:'0.08em', textTransform:'uppercase' }}>AI-Powered Staffing OS</p>
          </div>
        </div>

        {/* Session expired */}
        {sessionExpired && (
          <div style={{ marginBottom:'16px', padding:'12px 16px', background:'rgba(251,191,36,0.12)', border:'1px solid rgba(251,191,36,0.35)', borderRadius:'10px', fontSize:'13px', color:'#fbbf24', display:'flex', alignItems:'center', gap:'8px' }}>
            ⏰ Your session expired. Please sign in again.
          </div>
        )}

        {/* Card */}
        <div style={{ background:'rgba(255,255,255,0.05)', backdropFilter:'blur(20px)', borderRadius:'16px', padding:'32px', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 24px 64px rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign:'center', marginBottom:'24px' }}>
            <h2 style={{ fontSize:'16px', fontWeight:'600', color:'white', margin:'0 0 4px' }}>Welcome back</h2>
            <p style={{ fontSize:'13px', color:'rgba(255,255,255,0.4)', margin:0 }}>Sign in to your workspace</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'rgba(255,255,255,0.65)', marginBottom:'6px' }}>Email</label>
              <input name="email" type="email" required autoComplete="email"
                placeholder="admin@example.com" suppressHydrationWarning style={INP}
                onFocus={e=>(e.currentTarget.style.borderColor='#00b87c')}
                onBlur={e=>(e.currentTarget.style.borderColor='rgba(255,255,255,0.15)')}
              />
            </div>
            <div>
              <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'rgba(255,255,255,0.65)', marginBottom:'6px' }}>Password</label>
              <input name="password" type="password" required autoComplete="current-password"
                suppressHydrationWarning style={INP}
                onFocus={e=>(e.currentTarget.style.borderColor='#00b87c')}
                onBlur={e=>(e.currentTarget.style.borderColor='rgba(255,255,255,0.15)')}
              />
            </div>

            {error && (
              <div style={{ padding:'10px 14px', background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:'8px', fontSize:'13px', color:'#fca5a5' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{ width:'100%', padding:'13px', background:'#00b87c', color:'white', border:'none', borderRadius:'10px', fontSize:'14px', fontWeight:'700', cursor:loading?'not-allowed':'pointer', opacity:loading?0.8:1, letterSpacing:'0.02em', marginTop:'4px' }}>
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>

          <div style={{ marginTop:'20px', padding:'10px 14px', background:'rgba(0,184,124,0.07)', borderRadius:'8px', border:'1px solid rgba(0,184,124,0.18)' }}>
            <p style={{ fontSize:'11px', color:'rgba(255,255,255,0.35)', margin:0, textAlign:'center' }}>
              Demo: admin@example.com / changeme
            </p>
          </div>
        </div>

        <p style={{ textAlign:'center', marginTop:'24px', fontSize:'11px', color:'rgba(255,255,255,0.18)' }}>
          AVIIN Jobs Services © 2026 · AI Staffing Operating System
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{minHeight:'100vh',background:'#0f172a'}}/>}>
      <LoginForm />
    </Suspense>
  );
}
