import { pickLang, route } from '@/server/api';
import { newsMap } from '@/server/geo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings, portfolio, url }) => newsMap(settings, portfolio, pickLang(url.searchParams.get('lang'))));
