'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function DuplicatesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/resume-inbox'); }, []);
  return null;
}
