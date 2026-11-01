import { NextResponse } from 'next/server';
import { assertLocalRequest, HttpStatusError } from '@/server/api';
import { probeLlm } from '@/server/setup';
import { errorMessage } from '@/server/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertLocalRequest(req);
    return NextResponse.json(await probeLlm(await req.json()));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof HttpStatusError ? err.status : 500 });
  }
}
