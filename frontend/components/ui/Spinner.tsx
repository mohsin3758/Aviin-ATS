import { cn } from '@/lib/cn';

interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; className?: string; }

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const s = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' }[size];
  return (
    <div
      className={cn('animate-spin rounded-full border-2 border-gray-200 border-t-[--color-primary]', s, className)}
      aria-label="Loading"
    />
  );
}
