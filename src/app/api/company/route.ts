import { pickLang, route } from '@/server/api';
import { companyView } from '@/server/company';
import { targetFromUrl } from '@/server/company-target';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings, portfolio, url }) =>
  companyView(targetFromUrl(url), pickLang(url.searchParams.get('lang')), settings, portfolio));
