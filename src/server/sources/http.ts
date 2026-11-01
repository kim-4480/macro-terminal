// 브라우저를 흉내 낸 UA는 Yahoo가 쿠키 없는 요청으로 보고 429로 막는다. 정직한 도구 UA를 쓴다.
const UA = 'macro-terminal/0.3';

import { rawSettings } from '../config';

function blockedHosts(): string[] {
  try {
    return rawSettings().blockedHosts;
  } catch {
    return []; // 설정 오류가 데이터 화면까지 막지 않게 한다
  }
}

export class HttpError extends Error {
  constructor(readonly status: number, host: string) {
    super(`HTTP ${status} ${host}`);
  }
}

interface GetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export async function getResponse(url: string, { headers = {}, timeoutMs = 15_000, retries = 1 }: GetOptions = {}): Promise<Response> {
  const host = new URL(url).host;
  if (blockedHosts().includes(host)) throw new Error(`${host}: blockedHosts 설정으로 꺼져 있습니다`);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new HttpError(res.status, new URL(url).host);
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

export const getText = async (url: string, opts?: GetOptions): Promise<string> => (await getResponse(url, opts)).text();

export const getJson = async <T = unknown>(url: string, opts?: GetOptions): Promise<T> => JSON.parse(await getText(url, opts)) as T;

/** 인터넷 연결 확인(로컬 LLM과 무관) */
export async function internetOnline(): Promise<boolean> {
  try {
    const res = await fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    return res.status < 500;
  } catch {
    return false;
  }
}
