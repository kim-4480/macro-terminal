import { NextResponse } from 'next/server';
import { DEFAULT_LANG, isLang, type Lang } from '@/shared/languages';
import { ConfigError, loadConfig, type Portfolio, type Settings } from './config';
import { errorMessage } from './util';

export class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const pickLang = (v: string | null | undefined): Lang => (isLang(v) ? v : DEFAULT_LANG);

/**
 * 설정을 바꾸는 요청은 이 앱 화면에서 온 것만 받는다.
 * 다른 웹사이트가 127.0.0.1 로 몰래 보내는 요청을 막기 위해 Origin 과 전용 헤더를 확인한다
 * (전용 헤더가 있으면 다른 출처에서는 브라우저가 사전 확인 없이 보낼 수 없다).
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (req.headers.get('x-macro-terminal') !== '1' || (origin && host && new URL(origin).host !== host)) {
    throw new HttpStatusError(403, '이 앱 화면에서만 저장할 수 있습니다');
  }
}

/** 설정 화면용: 주소창이 이 컴퓨터를 가리킬 때만 받는다(DNS 를 바꿔치기해 키 시험을 시키는 것을 막는다) */
export function assertLocalRequest(req: Request): void {
  assertSameOrigin(req);
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.get('host') ?? '')) throw new HttpStatusError(403, '이 컴퓨터에서만 설정할 수 있습니다');
}

interface Ctx {
  settings: Settings;
  portfolio: Portfolio;
  url: URL;
  req: Request;
}

/** 라우트 핸들러 공통 래퍼: 설정 로드, JSON 응답, 오류 → { error } */
export function route<T>(fn: (ctx: Ctx) => T | Promise<T>) {
  return async (req: Request): Promise<NextResponse> => {
    try {
      const { settings, portfolio } = loadConfig();
      const body = await fn({ settings, portfolio, url: new URL(req.url), req });
      return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      const status = err instanceof HttpStatusError || err instanceof ConfigError ? err.status : 500;
      return NextResponse.json({ error: errorMessage(err) }, { status });
    }
  };
}
