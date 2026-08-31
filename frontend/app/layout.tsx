import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AVIIN ATS',
  description: 'AI-powered staffing & recruitment',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/icon-192.png',
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#1e3a5f" />
        <script dangerouslySetInnerHTML={{__html:`if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');`}}/>
        {/* Real bug fix (2026-08-31): reported live twice as "New Followup
            is not working" — investigated exhaustively via real headless-
            browser reproduction (fresh page load: works cleanly every
            time, zero console errors, zero validation gaps in the
            backend). Backend logs showed ZERO real POST /recruiter-tasks
            attempts from the reporting user's session, ever — meaning the
            click never even reached the network, consistent with a stale
            cached JS chunk reference after one of today's several backend
            redeploys, a well-known real Next.js failure mode (a page left
            open across a rebuild can reference a chunk file that no
            longer exists on the server). No global error handling existed
            anywhere in this app for this - added here, app-wide, so a
            stale-chunk failure on ANY click/navigation auto-reloads once
            instead of silently doing nothing. A sessionStorage guard
            prevents a reload loop if the real cause is something else. */}
        <script dangerouslySetInnerHTML={{__html:`(function(){
          function isChunkErr(msg){msg=String(msg||'');return /ChunkLoadError|Loading chunk [\\d]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module/i.test(msg);}
          function reloadOnce(){
            try{
              var last=Number(sessionStorage.getItem('_chunkReloadAt')||0);
              if(Date.now()-last<15000)return;
              sessionStorage.setItem('_chunkReloadAt',String(Date.now()));
              location.reload();
            }catch(e){location.reload();}
          }
          window.addEventListener('error',function(e){if(isChunkErr(e&&e.message))reloadOnce();});
          window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;if(isChunkErr(r&&(r.message||r)))reloadOnce();});
        })();`}}/>
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
