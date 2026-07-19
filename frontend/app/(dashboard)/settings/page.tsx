'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SettingsRoot() {
  const router = useRouter();
  useEffect(() => { router.replace('/settings/email'); }, []);
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'200px',color:'#64748b',fontSize:'14px'}}>
      Redirecting to Settings…
    </div>
  );
}
