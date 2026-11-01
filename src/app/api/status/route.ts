import { DEFAULT_LANG } from '@/shared/languages';
import { NextResponse } from 'next/server';
import type { StatusResponse } from '@/shared/types';
import { ConfigError, loadConfig } from '@/server/config';
import { jobStates } from '@/server/jobs';
import { llmStatus } from '@/server/llm';
import { isLocalUrl } from '@/server/llm-providers';
import { internetOnline } from '@/server/sources/http';
import { yfinanceAvailable } from '@/server/sources/yfinance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 설정 파일이 깨져도 상태 표시줄은 떠야 하므로 route() 래퍼를 쓰지 않는다.
export async function GET(): Promise<NextResponse<StatusResponse>> {
  let configError: string | null = null;
  let cfg: ReturnType<typeof loadConfig> | null = null;
  try {
    cfg = loadConfig();
  } catch (err) {
    configError = err instanceof ConfigError ? err.message : String(err);
  }
  const llmCfg = cfg?.settings.llm ?? { provider: 'openai' as const, baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', apiKey: '', disableThinking: false, timeoutMs: 600_000 };
  const [llm, internet] = await Promise.all([llmStatus(llmCfg), internetOnline()]);
  return NextResponse.json({
    llm: { ...llm, baseUrl: llmCfg.baseUrl, model: llmCfg.model, local: isLocalUrl(llmCfg.baseUrl) },
    setupDone: cfg?.settings.setupDone ?? false,
    internet,
    jobs: jobStates(),
    example: cfg?.portfolio.example ?? false,
    ecosKey: !!cfg?.settings.ecosApiKey,
    yfinance: yfinanceAvailable(),
    language: cfg?.settings.language ?? DEFAULT_LANG,
    configError,
    now: Date.now(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
