import { route } from '@/server/api';
import { marketRows } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings }) => marketRows(settings));
