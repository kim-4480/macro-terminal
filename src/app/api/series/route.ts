import { HttpStatusError, route } from '@/server/api';
import { seriesDetail } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings, url }) => {
  const id = url.searchParams.get('id');
  if (!id || !/^(fred|ecos|imf|yahoo|csv):.+/.test(id)) throw new HttpStatusError(400, 'id 는 fred:… / ecos:… / imf:… / yahoo:… / csv:… 형식이어야 합니다');
  return seriesDetail(id, url.searchParams.get('range') ?? '1y', settings);
});
