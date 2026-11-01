import type { Point } from '@/shared/types';
import { getText } from './http';

// IMF 데이터 API(SDMX 3.0, 키 불필요). 일본·중국처럼 FRED에서 갱신이 끊긴 나라의 물가 등에 쓴다.
// spec = "데이터셋/시계열키", 예: "CPI/JPN.CPI._T.YOY_PCH_PA_PT.M" (일본 CPI 전년비, 월)

/** "2026-M08" → "2026-08-01", "2026-Q2" → "2026-04-01", "2026" → "2026-01-01" */
export function imfPeriodToIso(p: string): string | null {
  let m = p.match(/^(\d{4})-M(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = p.match(/^(\d{4})-Q([1-4])$/);
  if (m) return `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01`;
  m = p.match(/^(\d{4})$/);
  return m ? `${m[1]}-01-01` : null;
}

export function parseImfCsv(spec: string, text: string): Point[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0]?.split(',') ?? [];
  const ti = head.indexOf('TIME_PERIOD');
  const vi = head.indexOf('OBS_VALUE');
  if (ti < 0 || vi < 0) throw new Error(`IMF ${spec}: 예상치 못한 응답`);
  const points: Point[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const date = imfPeriodToIso(cols[ti] ?? '');
    const v = cols[vi] ? Number(cols[vi]) : NaN;
    if (date && Number.isFinite(v)) points.push([date, v]);
  }
  return points.sort((a, b) => a[0].localeCompare(b[0]));
}

export async function imfSeries(spec: string, start: string): Promise<Point[]> {
  const slash = spec.indexOf('/');
  if (slash < 1) throw new Error(`IMF 시계열 형식이 틀렸습니다: ${spec}`);
  const dataset = spec.slice(0, slash);
  const key = spec.slice(slash + 1);
  const url = `https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/${encodeURIComponent(dataset)}/+/${key}?c%5BTIME_PERIOD%5D=ge:${start.slice(0, 4)}-01`;
  return parseImfCsv(spec, await getText(url, { timeoutMs: 30_000, headers: { Accept: 'application/vnd.sdmx.data+csv;version=2.0.0' } }));
}
