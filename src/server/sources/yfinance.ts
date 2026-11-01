import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CompanyProfile, Point } from '@/shared/types';
import { ROOT, SCRIPTS_DIR } from '../paths';
import type { Quote } from './yahoo';

// 프로젝트 .venv 의 yfinance 를 scripts/yf.py 로 호출한다(설치: npm run setup:yfinance).
const PYTHON = path.join(ROOT, '.venv/bin/python');
const SCRIPT = path.join(SCRIPTS_DIR, 'yf.py');

export const yfinanceAvailable = (): boolean => existsSync(PYTHON);

function run<T>(args: string[], timeoutMs = 30_000): Promise<T> {
  if (!yfinanceAvailable()) return Promise.reject(new Error('yfinance 미설치 (npm run setup:yfinance)'));
  return new Promise((resolve, reject) => {
    execFile(PYTHON, ['-I', '-W', 'ignore', SCRIPT, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`yfinance: ${(stderr || err.message).trim().split('\n').at(-1)}`));
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(new Error('yfinance: JSON 파싱 실패'));
      }
    });
  });
}

export type RawProfile = Omit<CompanyProfile, 'symbol' | 'summary' | 'summaryPending'> & { longBusinessSummary?: string | null };

export const yfProfile = (symbol: string): Promise<RawProfile> => run<RawProfile>(['profile', symbol]);

export async function yfHistory(symbol: string, period: string): Promise<Quote> {
  const { points } = await run<{ points: Point[] }>(['history', symbol, period], 60_000);
  if (!points?.length) throw new Error(`yfinance: ${symbol} 데이터 없음`);
  return { symbol, name: symbol, currency: null, marketTime: null, points, via: 'yfinance' };
}
