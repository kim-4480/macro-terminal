import { route } from '@/server/api';
import { macroRows } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings }) => macroRows(settings));
