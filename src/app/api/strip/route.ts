import { route } from '@/server/api';
import { stripItems } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings }) => stripItems(settings));
