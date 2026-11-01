import type { Point } from '@/shared/types';
import { getText } from './http';

/** FRED 공개 CSV(키 불필요). 결측값은 '.' 또는 빈 칸. */
export function parseFredCsv(id: string, text: string): Point[] {
  if (!text.startsWith('observation_date') && !text.startsWith('DATE')) throw new Error(`FRED ${id}: 예상치 못한 응답`);
  const points: Point[] = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(',');
    const v = Number(raw);
    if (date && raw && raw !== '.' && Number.isFinite(v)) points.push([date, v]);
  }
  return points;
}

export async function fredSeries(id: string, start?: string): Promise<Point[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}${start ? `&cosd=${start}` : ''}`;
  return parseFredCsv(id, await getText(url, { timeoutMs: 20_000 }));
}
