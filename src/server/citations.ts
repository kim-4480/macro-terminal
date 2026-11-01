import type { QuoteCheck } from '@/shared/types';

// 답변 속 인용문이 근거 원문에 그대로 있는지 확인한다.
// 형식: "...요약 문장 [S2] “원문에서 그대로 옮긴 문장”" — 따옴표 안이 S2 본문의 일부여야 한다.

/**
 * 비교용 정규화: 따옴표(지움)·대시·공백·대소문자 차이는 무시.
 * 모델이 발췌를 따옴표로 감싸며 안쪽 "..." 를 '...' 로 바꾸므로 따옴표는 종류를 맞추지 않고 뺀다.
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”„‟"″‘’‚‛'′`]/g, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/[\s ]+/g, ' ')
    .replace(/\s*([,.!?;:])\s*/g, '$1 ')
    .trim();
}

/** 인용문이 원문에 있는가. 생략 부호(...)로 나눈 조각이면 조각마다 순서대로 있어야 한다. */
export function quoteInSource(quote: string, source: string): boolean {
  const src = normalizeForMatch(source);
  // 말줄임표로 먼저 조각을 나눈 뒤 정규화(정규화하면 ... 의 모양이 바뀐다)
  const parts = quote.split(/\.{3}|…/).map((p) => normalizeForMatch(p).replace(/^[.,;:!?\s]+|[.,;:!?\s]+$/g, '')).filter((p) => p.length >= 6);
  if (!parts.length) return false;
  let from = 0;
  for (const p of parts) {
    const at = src.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

// [S2] 바로 뒤(또는 앞)의 “인용문” 을 짝지어 찾는다
// 발췌 안에는 여는 따옴표·근거 번호·줄바꿈이 없다 → 본문의 "일반 따옴표"와 뒤의 [S#] “발췌”를 하나로 잇지 않는다
// (기사의 [042700] 같은 대괄호는 발췌에 그대로 둔다)
const EXCERPT = String.raw`(?:(?!\[S\d+\])[^“”"\n]){6,600}`;
const CITED_QUOTE = new RegExp(String.raw`\[(S\d+)\][\s:—–-]*[“"](${EXCERPT})[”"]|[“"](${EXCERPT})[”"][\s—–-]*\[(S\d+)\]`, 'g');

export function extractQuotes(answer: string): { sourceId: string; quote: string }[] {
  const out: { sourceId: string; quote: string }[] = [];
  for (const m of answer.matchAll(CITED_QUOTE)) {
    const sourceId = m[1] ?? m[4]!;
    const quote = (m[2] ?? m[3]!).trim();
    out.push({ sourceId, quote });
  }
  return out;
}

/** 근거 표시([S#])가 붙은 문장 중 인용문이 없는 것의 수 — 규칙 위반 정도 */
export function countUncited(answer: string): number {
  return answer.split('\n').filter((l) => /\[S\d+\]/.test(l) && !/[“"][^”"]{6,}[”"]/.test(l)).length;
}

export function checkQuotes(answer: string, sources: Map<string, string>): QuoteCheck[] {
  return [
    ...extractQuotes(answer).map(({ sourceId, quote }): QuoteCheck => {
      const text = sources.get(sourceId);
      return { kind: 'quote', sourceId, quote, ok: !!text && quoteInSource(quote, text) };
    }),
    ...checkNumbers(answer, sources),
  ];
}

// 요약 문장 속 숫자(1,147억·7.15%·19일 등). 쉼표는 비교에서 뺀다.
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const plain = (s: string) => s.replace(/,/g, '');

const UNITS: Record<string, number> = { 천: 1e3, 만: 1e4, 억: 1e8, 조: 1e12, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, trillion: 1e12 };
const AMOUNT = /(\d[\d,]*(?:\.\d+)?)(?:\s*(trillion|billion|million|thousand|bn|mn|조|억|만|천|b|m)(?![a-z]))?/gi;

interface Amount { start: number; end: number; value: number; hasUnit: boolean; step: number }

/** 숫자를 단위까지 읽어 실제 값으로("1조 2,760억"은 하나로). step 은 적힌 자릿수의 한 칸(반올림 판단용) */
function readAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const digits = plain(m[1]!).replace(/\.$/, '');
    const unitName = m[2]?.toLowerCase();
    const unit = unitName ? UNITS[unitName]! : 1;
    const dot = digits.indexOf('.');
    // 끝의 0은 유효숫자가 3자리 이상일 때만 반올림으로 본다(1,280억은 1,276억의 반올림, 300억은 262억의 반올림이 아니다)
    const zeros = /0*$/.exec(digits)![0].length;
    const place = dot >= 0 ? 10 ** -(digits.length - dot - 1) : digits.length - zeros >= 3 ? 10 ** zeros : 1;
    const a: Amount = { start: m.index, end: m.index + m[0].length, value: Number(digits) * unit, hasUnit: !!unitName, step: place * unit };
    const prev = out.at(-1);
    if (unitName === '억' && prev && prev.hasUnit && prev.value % 1e12 === 0 && !text.slice(prev.end, a.start).trim()) {
      out[out.length - 1] = { ...a, start: prev.start, value: prev.value + a.value };
    } else {
      out.push(a);
    }
  }
  return out;
}

/** 요약의 금액이 원문 값을 자릿수대로 반올림한 것과 같은가(262억 = $26.2 billion, 262억 ≠ $26.2 million) */
const sameAmount = (a: Amount, source: Amount[]) => a.hasUnit && source.some((s) => Math.abs(a.value - s.value) <= (a.step / 2) * (1 + 1e-9));

/**
 * 근거가 붙은 줄의 "요약 부분"(따옴표 밖)에 나온 숫자가 그 줄이 가리키는 근거 원문에 있는지.
 * 발췌에는 없는 숫자를 요약에 지어 넣는 것을 잡는다. 한 자리 숫자(1분기 등)는 흔해서 건너뛴다.
 * 그대로 없으면 단위를 맞춰 값으로 한 번 더 본다(모델이 달러 기사를 억 단위로 옮긴 경우).
 */
export function checkNumbers(answer: string, sources: Map<string, string>): QuoteCheck[] {
  const out: QuoteCheck[] = [];
  for (const line of answer.split('\n')) {
    const ids = [...line.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]!);
    if (!ids.length) continue;
    const summary = line.replace(/[“"][^”"]*[”"]/g, ' ').replace(/\[[SN]\d+\]/g, ' ');
    // 같은 줄의 검색 결과 번호([N#])는 대조 대상은 아니지만, 그 제목에 나온 숫자는 지어낸 것이 아니다
    const titles = [...line.matchAll(/\[(N\d+)\]/g)].map((m) => sources.get(m[1]!) ?? '');
    const raw = [...ids.map((id) => sources.get(id) ?? ''), ...titles].join('\n');
    const texts = plain(raw);
    const amounts = readAmounts(summary);
    const sourceAmounts = readAmounts(raw);
    for (const m of summary.matchAll(NUMBER)) {
      const n = plain(m[0]).replace(/\.$/, '');
      if (n.replace('.', '').length < 2) continue;
      const amount = amounts.find((a) => m.index >= a.start && m.index < a.end);
      out.push({ kind: 'number', sourceId: ids[0]!, quote: m[0], ok: texts.includes(n) || (!!amount && sameAmount(amount, sourceAmounts)) });
    }
  }
  return out;
}
