import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { SessionProvider } from '../lib/session-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Money Movement',
  description: 'Closed-loop simulated BDT money movement platform.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
