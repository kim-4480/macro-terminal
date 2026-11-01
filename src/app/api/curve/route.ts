import { route } from '@/server/api';
import { yieldCurve } from '@/server/market-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(({ settings }) => yieldCurve(settings));
