import { HttpStatusError, pickLang, route } from '@/server/api';
import { companyProfile } from '@/server/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings, url }) => {
  const symbol = url.searchParams.get('symbol');
  if (!symbol) throw new HttpStatusError(400, 'symbol 필요');
  return companyProfile(symbol, pickLang(url.searchParams.get('lang')), settings);
});
