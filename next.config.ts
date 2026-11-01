import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // 로컬 앱: 외부에 노출하지 않는다(next dev/start 에 -H 127.0.0.1 권장)
  poweredByHeader: false,
};

export default config;
