import { baseLang, withLang, type BaseLang } from '@/shared/languages';
import type { Stance } from '@/shared/journal';
import type { Lang } from '@/shared/types';
import type { Settings } from '../config';
import { runJob } from '../jobs';
import { chat } from '../llm';
import { hash, today } from '../util';
import { journalDb } from './db';
import { closes } from './ledger';

// AI Self-Evaluation: 에이전트가 답에서 낸 해석("해석: …")을 종목별 의견(상승·하락·중립)으로 기록하고,
// 사용자 매매와 똑같이 7·30·90일 뒤 시장 대비 성과로 채점한다(outcomes.ts 의 같은 계산).
// 의견 방향은 작은 모델이 JSON 스키마 안에서 고른다. 방향이 안 보이면 기록하지 않는다.

/** 답에서 해석 문장만 */
export function interpretationLines(answer: string): string[] {
  return answer
    .split('\n')
    .map((l) => l.replace(/^[-*>#\s]+/, '').trim())
    .filter((l) => /^(해석|interpretation)\s*[:：]/i.test(l))
    .map((l) => l.replace(/^(해석|interpretation)\s*[:：]\s*/i, '').slice(0, 400));
}

const PROMPT: Record<BaseLang, string> = {
  ko: '아래 해석 문장이 각 종목의 앞으로의 주가를 어느 쪽으로 보는지 고른다. up=오를 것, down=내릴 것, neutral=보합·혼조, none=방향을 말하지 않음. 문장에 없는 판단을 더하지 않는다.',
  en: 'For each ticker, decide which way the interpretation expects the price to go: up, down, neutral (flat/mixed), or none (no direction stated). Do not add judgments not in the text.',
};

export function recordOpinions(settings: Settings, lang: Lang, chatId: string | null, answer: string, symbols: string[]): void {
  const lines = interpretationLines(answer);
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 6);
  if (!lines.length || !syms.length) return;
  const text = lines.join(' ').slice(0, 800);
  void runJob(`aiop:${hash(`${chatId}:${text}`)}`, async () => {
    const schema = {
      type: 'object',
      properties: { opinions: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string', enum: syms }, stance: { type: 'string', enum: ['up', 'down', 'neutral', 'none'] } }, required: ['symbol', 'stance'] } } },
      required: ['opinions'],
    };
    const out = await chat(settings.llm, [{ role: 'system', content: withLang(PROMPT[baseLang(lang)], lang) }, { role: 'user', content: `Tickers: ${syms.join(', ')}\n\n${text}` }], { maxTokens: 300, temperature: 0, schema });
    const parsed = JSON.parse(out) as { opinions?: { symbol?: string; stance?: string }[] };
    const db = journalDb();
    const date = today();
    for (const o of parsed.opinions ?? []) {
      if (!o.symbol || !syms.includes(o.symbol) || !['up', 'down', 'neutral'].includes(o.stance ?? '')) continue;
      const base = (await closes(o.symbol).catch(() => null))?.points.at(-1)?.[1];
      if (!base) continue;
      // 같은 대화·같은 날·같은 종목은 마지막 의견 하나만
      db.prepare('DELETE FROM ai_opinions WHERE chat_id IS ? AND date = ? AND symbol = ?').run(chatId, date, o.symbol);
      db.prepare('INSERT INTO ai_opinions (chat_id, created_at, date, symbol, stance, text, base_price) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(chatId, Date.now(), date, o.symbol, o.stance as Stance, text, base);
    }
  });
}
