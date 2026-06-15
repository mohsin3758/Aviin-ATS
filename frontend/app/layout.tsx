import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'FinStack Staffing OS',
  description: 'Zero-Token AI Staffing/ATS Operating System',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
