import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'AVIIN ATS',
  description: 'AI-powered staffing & recruitment',
  manifest: '/manifest.json',
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
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
