'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function SettingsSMS() {
  const router = useRouter();
  useEffect(() => { router.replace('/sms'); }, []);
  return null;
}
