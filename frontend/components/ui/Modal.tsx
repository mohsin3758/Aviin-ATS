import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const widths: Record<string, string> = { sm: '440px', md: '580px', lg: '720px', xl: '960px' };

  return createPortal(
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999,
        background: 'rgba(15,23,42,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: widths[size],
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
          position: 'relative',
          zIndex: 10000,
        }}
      >
        {/* Sticky Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid #f1f5f9', flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0' }}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            style={{
              width: '32px', height: '32px', borderRadius: '8px',
              border: 'none', background: '#f1f5f9', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <X size={16} style={{ color: '#64748b' }} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', minHeight: 0 }}>
          {children}
        </div>

        {/* Sticky Footer */}
        {footer && (
          <div style={{
            padding: '14px 24px',
            borderTop: '1px solid #f1f5f9',
            background: '#fafafa',
            borderRadius: '0 0 16px 16px',
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}
export function FormField({ label, required, children, hint }: FormFieldProps) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '5px' }}>
        {label} {required && <span style={{ color: '#ef4444' }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>{hint}</p>}
    </div>
  );
}

interface FormRowProps { children: React.ReactNode; cols?: number; }
export function FormRow({ children, cols = 2 }: FormRowProps) {
  const colStr = 'repeat(' + String(cols) + ', 1fr)';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: colStr, gap: '14px' }}>
      {children}
    </div>
  );
}

interface FormActionsProps {
  onClose: () => void;
  onSubmit: () => void;
  loading?: boolean;
  submitLabel?: string;
}
export function FormActions({ onClose, onSubmit, loading, submitLabel = 'Save' }: FormActionsProps) {
  return (
    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
      <button
        onClick={onClose}
        style={{
          padding: '9px 20px', borderRadius: '8px',
          border: '1px solid #e2e8f0', background: 'white',
          fontSize: '13px', fontWeight: '500', color: '#374151', cursor: 'pointer',
        }}
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={loading}
        style={{
          padding: '9px 24px', borderRadius: '8px',
          border: 'none', background: '#1e40af', color: 'white',
          fontSize: '13px', fontWeight: '600',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Saving...' : submitLabel}
      </button>
    </div>
  );
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '18px 0 14px' }}>
      <span style={{
        fontSize: '10px', fontWeight: '700', color: '#94a3b8',
        textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: '1px', background: '#f1f5f9' }} />
    </div>
  );
}
