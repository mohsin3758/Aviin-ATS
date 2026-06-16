'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getTokenPayload, type TokenPayload } from '@/lib/auth';

interface TenantCtx {
  tenantId: string;
  userId: string;
  role: string;
  email: string;
  fullName: string;
}

const TenantContext = createContext<TenantCtx | null>(null);

export function useTenant(): TenantCtx {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used inside TenantProvider');
  return ctx;
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TenantCtx | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const payload: TokenPayload | null = getTokenPayload();
    if (!payload) {
      if (pathname !== '/login') router.replace('/login');
      return;
    }
    setCtx({
      tenantId: payload.tenant_id,
      userId: payload.sub,
      role: payload.role,
      email: payload.email ?? '',
      fullName: payload.full_name ?? '',
    });
  }, [pathname, router]);

  if (!ctx) return null;
  return <TenantContext.Provider value={ctx}>{children}</TenantContext.Provider>;
}
