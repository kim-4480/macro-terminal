import { NextResponse } from 'next/server';
import { assertLocalRequest, HttpStatusError } from '@/server/api';
import { ConfigError } from '@/server/config';
import { saveSetup, setupView } from '@/server/setup';
import { errorMessage } from '@/server/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (err: unknown) => NextResponse.json({ error: errorMessage(err) }, { status: err instanceof HttpStatusError || err instanceof ConfigError ? err.status : 500 });

// route() 래퍼는 설정을 먼저 읽으므로, 설정을 고치는 이 화면에서는 쓰지 않는다.
export function GET(): NextResponse {
  try {
    return NextResponse.json(setupView(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertLocalRequest(req);
    return NextResponse.json(saveSetup(await req.json()));
  } catch (err) {
    return fail(err);
  }
}
