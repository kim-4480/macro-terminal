import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from 'next/font/google';
import type { ReactNode } from 'react';
import '@/trade/trade.css';

// 모의 매매 앱: 터미널과 따로 묶이는 작은 화면(스마트폰~태블릿). 데이터(API·DB)는 터미널과 같다.
const sans = IBM_Plex_Sans_KR({ weight: ['400', '500', '600', '700'], subsets: ['latin'], preload: false, variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Macro Terminal · Paper trading',
  description: 'Portfolio balance, paper orders and trading journal',
  // 휴대폰에서 홈 화면에 추가하면 주소창 없는 앱처럼 열린다
  manifest: '/trade.webmanifest',
  appleWebApp: { capable: true, title: 'Paper trading', statusBarStyle: 'default' },
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
  viewportFit: 'cover',
};

export default function TradeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
