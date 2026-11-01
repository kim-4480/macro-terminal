import { route } from '@/server/api';
import { search } from '@/server/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ?q= &deep=0 이면 빠른 단계만(로컬·KRX·기억된 결과) */
export const GET = route(({ settings, portfolio, url }) =>
  search(url.searchParams.get('q') ?? '', settings, portfolio, { deep: url.searchParams.get('deep') !== '0' }));
