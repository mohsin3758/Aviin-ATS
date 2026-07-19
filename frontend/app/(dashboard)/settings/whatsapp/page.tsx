'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function SettingsWhatsApp() {
  const router = useRouter();
  useEffect(() => { router.replace('/whatsapp'); }, []);
  return null;
}
