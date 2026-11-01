import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from 'next/font/google';
import type { ReactNode } from 'react';
import '../globals.css';

// 빌드 때 받아 로컬에서 서빙(실행 중에는 외부 요청 없음)
const sans = IBM_Plex_Sans_KR({ weight: ['400', '500', '600', '700'], subsets: ['latin'], preload: false, variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ weight: ['400', '500', '600', '700'], subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Macro Terminal',
  description: 'Macro indicators and your portfolio’s industries on one screen',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07070b',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
