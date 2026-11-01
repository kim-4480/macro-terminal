import type { Point } from '@/shared/types';
import { getJson } from './http';

// 한국은행 ECOS. 인증키 필요(무료): https://ecos.bok.or.kr/api/
// spec = "통계코드/주기/항목코드", 예: "722Y001/D/0101000"

type Cycle = 'D' | 'M' | 'Q' | 'A';
const pad = (n: number) => String(n).padStart(2, '0');

function range(cycle: Cycle, startIso: string, endIso: string): [string, string] {
  const [sy, sm] = startIso.split('-');
  const [ey, em] = endIso.split('-');
  if (cycle === 'D') return [startIso.replaceAll('-', ''), endIso.replaceAll('-', '')];
  if (cycle === 'M') return [`${sy}${sm}`, `${ey}${em}`];
  if (cycle === 'Q') return [`${sy}Q1`, `${ey}Q4`];
  return [sy!, ey!];
}

export function ecosTimeToIso(cycle: Cycle, t: string): string {
  if (cycle === 'D') return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (cycle === 'M') return `${t.slice(0, 4)}-${t.slice(4, 6)}-01`;
  if (cycle === 'Q') return `${t.slice(0, 4)}-${pad((Number(t.slice(5)) - 1) * 3 + 1)}-01`;
  return `${t.slice(0, 4)}-01-01`;
}

interface EcosResponse {
  RESULT?: { MESSAGE: string };
  StatisticSearch?: { row?: { TIME: string; DATA_VALUE: string }[] };
}

export async function ecosSeries(apiKey: string, spec: string, startIso: string, endIso: string): Promise<Point[]> {
  const [stat, cycleRaw, ...items] = spec.split('/');
  const cycle = cycleRaw as Cycle;
  const [s, e] = range(cycle, startIso, endIso);
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}/json/kr/1/10000/${stat}/${cycle}/${s}/${e}/${items.join('/')}`;
  const json = await getJson<EcosResponse>(url, { timeoutMs: 20_000 });
  if (json.RESULT) throw new Error(`ECOS ${spec}: ${json.RESULT.MESSAGE}`);
  return (json.StatisticSearch?.row ?? [])
    .map((r): Point => [ecosTimeToIso(cycle, r.TIME), Number(r.DATA_VALUE)])
    .filter((p) => Number.isFinite(p[1]))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
