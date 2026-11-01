import type { Point } from '@/shared/types';
import { safeFetchText } from './article';
import { imfPeriodToIso } from './imf';

// 공개 CSV 파일에서 시계열 읽기. 경로는 에이전트가 찾아 사용자 승인을 받은 것이다.
// spec = "주소#date=날짜 열&value=값 열&where=열:값" (where 는 여러 나라가 섞인 파일에서 한 줄만 고를 때)

export interface CsvSpec {
  url: string;
  date: string | null;
  value: string | null;
  where: { column: string; value: string } | null;
}

export function parseCsvSpec(spec: string): CsvSpec {
  const hash = spec.indexOf('#');
  const url = hash < 0 ? spec : spec.slice(0, hash);
  if (!/^https:\/\//.test(url)) throw new Error('csv: 경로는 https 주소여야 합니다');
  const q = new URLSearchParams(hash < 0 ? '' : spec.slice(hash + 1));
  const where = q.get('where');
  const colon = where?.indexOf(':') ?? -1;
  return { url, date: q.get('date'), value: q.get('value'), where: where && colon > 0 ? { column: where.slice(0, colon), value: where.slice(colon + 1) } : null };
}

/** 따옴표를 지키며 한 줄을 나눈다. 구분 문자는 머리글에서 정한다 */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === sep && !quoted) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** 2026-08-15, 2026-08, 202608, 2026-M08, 2026-Q2, 2026, 2026/08/15 → ISO 날짜 */
export function csvDateToIso(raw: string): string | null {
  const s = raw.replace(/\//g, '-');
  const day = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (day) return `${day[1]}-${day[2]!.padStart(2, '0')}-${day[3]!.padStart(2, '0')}`;
  const month = s.match(/^(\d{4})-?(\d{2})$/);
  if (month) return `${month[1]}-${month[2]}-01`;
  return imfPeriodToIso(s);
}

export function parseCsv(text: string, spec: Pick<CsvSpec, 'date' | 'value' | 'where'>): Point[] {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const first = lines[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  const head = splitLine(first, sep);
  const col = (name: string) => {
    const i = head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`CSV 에 "${name}" 열이 없습니다. 열: ${head.slice(0, 20).join(', ')}`);
    return i;
  };
  const di = spec.date ? col(spec.date) : 0;
  const vi = spec.value ? col(spec.value) : head.length - 1;
  const wi = spec.where ? col(spec.where.column) : -1;
  const points: Point[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitLine(line, sep);
    if (wi >= 0 && cols[wi] !== spec.where!.value) continue;
    const date = csvDateToIso(cols[di] ?? '');
    const v = cols[vi] ? Number(cols[vi]) : NaN;
    if (date && Number.isFinite(v)) points.push([date, v]);
  }
  return points.sort((a, b) => a[0].localeCompare(b[0]));
}

export async function csvSeries(raw: string): Promise<Point[]> {
  const spec = parseCsvSpec(raw);
  const { body } = await safeFetchText(spec.url, 'text/csv,text/plain,*/*');
  return parseCsv(body, spec);
}
