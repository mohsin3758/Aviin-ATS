import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:   'bg-[--color-primary] text-white hover:bg-[--color-primary-dark]',
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        outline:   'border border-gray-300 bg-transparent hover:bg-gray-50',
        ghost:     'bg-transparent hover:bg-gray-100',
        danger:    'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2',
        lg: 'px-6 py-2.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
