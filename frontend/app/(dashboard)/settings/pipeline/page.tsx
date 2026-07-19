'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function SettingsPipeline() {
  const router = useRouter();
  useEffect(() => { router.replace('/pipeline'); }, []);
  return null;
}
