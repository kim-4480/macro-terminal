// 검색어 맞추기 규칙(목록이 아니라 규칙): 정규화, 영어 글자 이름의 한글 표기, 비슷한 표기 점수.

// 영어 글자 이름의 한글 표기(티에스엠씨 → tsmc). 지는 g, 제트·제드는 z. (규칙이라 목록이 아님)
const LETTERS: [string, string][] = [
  ['더블유', 'w'], ['에이치', 'h'], ['에이', 'a'], ['에프', 'f'], ['에스', 's'], ['엑스', 'x'], ['엘', 'l'], ['엠', 'm'], ['엔', 'n'],
  ['제이', 'j'], ['케이', 'k'], ['아이', 'i'], ['브이', 'v'], ['와이', 'y'], ['제트', 'z'], ['제드', 'z'],
  ['비', 'b'], ['씨', 'c'], ['시', 'c'], ['디', 'd'], ['이', 'e'], ['지', 'g'], ['오', 'o'], ['피', 'p'], ['큐', 'q'], ['알', 'r'], ['티', 't'], ['유', 'u'],
];

/**
 * 연달아 2개 이상 나오는 "영어 글자 이름"만 영어로 바꾼다.
 *   티에스엠씨 → tsmc, 에스케이하이닉스 → sk하이닉스, 엘지에너지솔루션 → lg에너지솔루션
 *   하이닉스의 "이"처럼 혼자 나온 글자는 그대로 둔다.
 */
export function spelledLetters(s: string): string {
  const out: string[] = [];
  let run: { text: string; latin: string }[] = [];
  const flush = () => {
    out.push(run.length >= 2 ? run.map((r) => r.latin).join('') : run.map((r) => r.text).join(''));
    run = [];
  };
  let i = 0;
  while (i < s.length) {
    const hit = LETTERS.find(([ko]) => s.startsWith(ko, i));
    if (hit) { run.push({ text: hit[0], latin: hit[1] }); i += hit[0].length; continue; }
    flush();
    out.push(s[i]!);
    i++;
  }
  flush();
  return out.join('');
}

export const norm = (s: string | undefined | null): string => String(s ?? '').toLowerCase().replace(/[\s·.,()&/-]/g, '');
export const hasHangul = (s: string): boolean => /[가-힣]/.test(s);

function variants(nq: string): string[] {
  const alt = norm(spelledLetters(nq).replaceAll('s원', 's1'));
  return alt === nq ? [nq] : [nq, alt];
}

/** 두 글자 묶음(bigram) 겹침 정도 0~1 — 조금 틀린 표기를 잡는다 */
export function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

function score1(name: string | undefined, q: string): number {
  const n = norm(name);
  if (!n || !q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80 - Math.min(n.length - q.length, 20);
  if (n.includes(q)) return 50 - Math.min(n.length - q.length, 20);
  // 비슷한 표기(4글자 이상)는 낮은 점수로
  if (n.length >= 4 && q.length >= 4) {
    const d = dice(n, q);
    if (d >= 0.6) return Math.round(20 + 50 * d);
  }
  return 0;
}

/** 0(불일치) ~ 100(완전 일치) */
export function score(name: string | undefined, nq: string): number {
  return Math.max(...variants(nq).map((q) => score1(name, q)));
}

