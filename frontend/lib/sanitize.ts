// QA sweep (2026-09-01) — real, previously-exploitable stored XSS found
// in the Conversations page: `candidate_messages.body` can contain
// unescaped, candidate-supplied data (e.g. full_name, submitted via any
// public/anonymous candidate-creation form and later substituted into a
// stage-change email body server-side with no HTML-escaping before
// storage) — the frontend then rendered it via dangerouslySetInnerHTML
// whenever it merely CONTAINED a '<' and a '>' anywhere, letting a
// malicious candidate's name execute script in any authenticated
// admin/manager/recruiter's browser the moment they viewed that
// candidate's message thread.
//
// DOMPurify is the fix, but the plain browser build crashes with
// "sanitize is not a function" during Next.js's server-side static
// prerendering pass (even for 'use client' components, which Next.js
// still renders once on the server to produce initial HTML) — it needs
// a real DOM, which doesn't exist there. The natural fix,
// isomorphic-dompurify (a jsdom-backed SSR-safe wrapper), turned out to
// need a newer Node.js `webidl.util.markAsUncloneable` than this
// project's actual Docker build image ships — a real environment-parity
// gap, not something to paper over by guessing at a Docker base-image
// bump mid-fix. Guarding on `typeof window` instead avoids needing
// jsdom in Node at all: every one of the real call sites (Conversations,
// the KAE/email-template previews, the two signature builders) is a
// genuine `'use client'` component that re-renders once real, hydrated
// browser JS runs, so an empty string during the one server-side pass is
// invisible to a real user and the actual sanitized content still
// renders correctly moments later on the client.
import DOMPurify from 'dompurify';

export function safeSanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(html);
}
