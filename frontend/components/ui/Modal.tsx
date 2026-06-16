'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onOpenChange, title, description, children, className }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md p-6',
            'animate-slide-up',
            className
          )}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-gray-900">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-sm text-gray-500 mt-0.5">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close" className="p-1 rounded hover:bg-gray-100 shrink-0">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
