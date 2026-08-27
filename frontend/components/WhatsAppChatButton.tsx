'use client';
import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { apiFetch } from '@/lib/useFetch';

// Real, free, zero-infrastructure WhatsApp outreach (2026-08-27) — opens
// wa.me with the recruiter's OWN already-logged-in WhatsApp Web/App, so
// it works for EVERY user immediately, regardless of whether they've
// connected a personal WAHA session. The message happens OUTSIDE this
// app (in the user's own WhatsApp client) — there's no API access into a
// personal, non-WAHA session, so this can't auto-log what was actually
// sent. The optional "Log this outreach" button after opening the link
// is a real, honest, manual record — never fabricated.

function normalizePhone(phone: string): string {
  let p = (phone || '').trim().replace(/[\s-]/g, '');
  if (!p.startsWith('+')) p = '+91' + p.replace(/^0+/, '').slice(-10);
  return p.replace('+', '');
}

export default function WhatsAppChatButton({
  phone, candidateId, candidateName, defaultMessage,
}: { phone?: string | null; candidateId?: string; candidateName?: string; defaultMessage?: string }) {
  const [opened, setOpened] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);

  if (!phone) return null;
  const waPhone = normalizePhone(phone);
  const text = defaultMessage || (candidateName ? `Hi ${candidateName.split(' ')[0]}, ` : '');
  const url = `https://wa.me/${waPhone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  const logOutreach = async () => {
    if (!candidateId) return;
    setLogging(true);
    try {
      await apiFetch('/communications/log-manual', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: candidateId, channel: 'whatsapp',
          body: text || '(sent via click-to-chat, exact text not captured by the app)',
          metadata: { via: 'click_to_chat' },
        }),
      });
      setLogged(true);
    } catch { /* best-effort */ }
    setLogging(false);
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={() => setOpened(true)}
        title="Opens WhatsApp on your own device, from your own number"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px',
          background: '#22c55e', color: 'white', borderRadius: '8px', fontSize: '12px',
          fontWeight: 700, textDecoration: 'none',
        }}
      >
        <MessageCircle size={14} /> Message on WhatsApp
      </a>
      {opened && candidateId && !logged && (
        <button
          onClick={logOutreach}
          disabled={logging}
          style={{
            padding: '5px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '7px',
            fontSize: '11px', fontWeight: 600, color: '#64748b', cursor: logging ? 'default' : 'pointer',
          }}
        >
          {logging ? 'Logging…' : 'Log this outreach'}
        </button>
      )}
      {logged && <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>✓ Logged</span>}
    </div>
  );
}
