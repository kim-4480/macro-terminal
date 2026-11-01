import type { LlmConfig } from './config';
import { isLocalUrl, providerFor, type LlmStatus, type ToolMessage, type ToolSpec } from './llm-providers';

export type { ToolMessage, ToolSpec } from './llm-providers';

// 모든 LLM 호출이 지나는 곳. 제공자별 요청 형식은 llm-providers.ts 가 맡는다.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const STATUS_TTL_MS = 5000;

const g = globalThis as typeof globalThis & {
  __llmQueue?: { active: number; waiting: (() => void)[] };
  __llmStatus?: Map<string, { at: number; value: Promise<LlmStatus> }>;
};

/** 켜져 있는지 확인. 원격 API 에 요청이 몰리지 않게 잠깐 기억한다 */
export function llmStatus(cfg: LlmConfig): Promise<LlmStatus> {
  const cache = (g.__llmStatus ??= new Map());
  const key = `${cfg.provider}|${cfg.baseUrl}|${cfg.apiKey}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value;
  const value = providerFor(cfg).status(cfg);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** 동시 호출 수 제한. 로컬 모델은 기본 한 번에 하나, 원격 API 는 기본 넷 */
function limited<T>(cfg: LlmConfig, fn: () => Promise<T>): Promise<T> {
  const q = (g.__llmQueue ??= { active: 0, waiting: [] });
  const max = cfg.maxConcurrent ?? (isLocalUrl(cfg.baseUrl) ? 1 : 4);
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      q.active++;
      fn().then(resolve, reject).finally(() => {
        q.active--;
        q.waiting.shift()?.();
      });
    };
    if (q.active < max) start();
    else q.waiting.push(start);
  });
}

const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/** 답에서 JSON 만 꺼낸다(구조화 출력을 지원하지 않는 서버는 코드 울타리나 설명을 덧붙인다). 없으면 null */
export function extractJson(text: string): string | null {
  const parses = (x: string) => { try { JSON.parse(x); return true; } catch { return false; } };
  const t = text.trim();
  if (parses(t)) return t;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim();
  if (fenced && parses(fenced)) return fenced;
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start >= 0 && end > start && parses(t.slice(start, end + 1))) return t.slice(start, end + 1);
  return null;
}

/**
 * 모델이 반복에 빠졌을 때 남은 답을 정리한다(샘플링 벌점은 원문 발췌·숫자를 그대로 옮기는 것까지 막아서 쓰지 않는다): 같은 문단·같은 줄은 처음 것만 두고,
 * 한 줄 안에서 같은 문장이 이어지면 한 번만 남긴다.
 */
export function collapseRepeats(text: string): string {
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
  const seenPara = new Set<string>();
  const paras: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const lines: string[] = [];
    let prev = '';
    for (const raw of para.split('\n')) {
      // 문장 단위로 나눠 바로 앞 문장과 같은 문장은 뺀다(정규식 역참조보다 긴 줄에서 빠르다)
      const sents = raw.split(/(?<=[.!?。])\s+/);
      const line = sents.filter((x, i) => i === 0 || norm(x).length < 10 || norm(x) !== norm(sents[i - 1]!)).join(' ');
      const n = norm(line);
      if (n.length >= 20 && n === prev) continue;
      lines.push(line);
      prev = n;
    }
    const p = lines.join('\n');
    const key = norm(p);
    if (key.length >= 20 && seenPara.has(key)) continue;
    if (key) seenPara.add(key);
    paras.push(p);
  }
  return paras.join('\n\n').trim();
}

interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /** 대기열을 건너뛴다(검색처럼 짧고 급한 요청용) */
  direct?: boolean;
  timeoutMs?: number;
  /** JSON 스키마를 주면 그 형식으로만 답하게 한다(제공자가 지원하면 형식을 강제하고, 아니면 답에서 JSON 을 꺼낸다) */
  schema?: Record<string, unknown>;
}

// 작은 모델은 "한자를 섞지 말라"는 규칙을 줘도 한국어 답에 한자·일본어를 흘린다("가장 큰单日 하락").
// 답 전체를 다시 쓰게 하면 다른 곳이 망가지니, 그 단어만 한국어로 옮겨 바꾼다. 따옴표 안 발췌는 원문이라 그대로 둔다.
const FOREIGN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
const QUOTED = /([“"][^“”"\n]*[”"])/;
const HANGUL = /\p{Script=Hangul}/u;

/** 따옴표 밖 글의 한자·일본어 단어(중복 제거). 한글이 없는 글(영어 답 등)은 대상이 아니다 */
export function foreignWords(text: string): string[] {
  if (!HANGUL.test(text)) return [];
  return [...new Set(text.split(QUOTED).filter((_, i) => i % 2 === 0).flatMap((part) => part.match(FOREIGN) ?? []))];
}

/** 따옴표 밖의 단어만 바꾼다. 한글 바로 뒤에 붙어 있었으면 띄어 쓴다 */
export function replaceForeign(text: string, map: Map<string, string>): string {
  return text.split(QUOTED).map((part, i) => (i % 2 ? part : part.replace(FOREIGN, (w, at: number) => {
    const ko = map.get(w);
    if (!ko) return w;
    return at > 0 && HANGUL.test(part[at - 1]!) ? ` ${ko}` : ko;
  }))).join('');
}

/** 한국어 글에 섞인 한자·일본어 단어를 한국어로. 실패하면 글을 그대로 돌려준다 */
export async function fixForeignWords(cfg: LlmConfig, text: string): Promise<string> {
  const words = foreignWords(text).slice(0, 20);
  if (!words.length) return text;
  try {
    const context = words.map((w) => `${w}: ${text.split('\n').find((l) => l.includes(w))?.slice(0, 200) ?? ''}`).join('\n');
    const schema = {
      type: 'object',
      properties: { words: { type: 'array', items: { type: 'object', properties: { word: { type: 'string', enum: words }, korean: { type: 'string' } }, required: ['word', 'korean'] } } },
      required: ['words'],
    };
    const out = await chat(cfg, [
      { role: 'system', content: '각 줄의 맨 앞 단어는 한국어 글에 잘못 섞인 한자나 일본어다. 뒤의 문장 흐름에 맞는 한국어 단어로 옮긴다. 한글로만 쓰고, 문장 전체를 옮기지 않는다.' },
      { role: 'user', content: context },
    ], { direct: true, schema, temperature: 0, maxTokens: 300, timeoutMs: 30_000 });
    const parsed = JSON.parse(out) as { words?: { word?: string; korean?: string }[] };
    const map = new Map<string, string>();
    for (const { word, korean } of parsed.words ?? []) {
      const ko = korean?.trim();
      if (word && ko && ko.length <= 30 && HANGUL.test(ko) && !ko.match(FOREIGN)) map.set(word, ko);
    }
    return replaceForeign(text, map);
  } catch {
    return text;
  }
}

export function chat(cfg: LlmConfig, messages: ChatMessage[], { maxTokens = 1500, temperature = 0.3, direct = false, timeoutMs, schema }: ChatOptions = {}): Promise<string> {
  const ask = async (msgs: ChatMessage[]) => stripThink((await providerFor(cfg).complete(cfg, { messages: msgs, maxTokens, temperature, schema, timeoutMs: timeoutMs ?? cfg.timeoutMs })).content);
  const run = async () => {
    const clean = await ask(messages);
    if (!schema) return fixForeignWords(cfg, collapseRepeats(clean));
    const json = extractJson(clean);
    if (json != null) return json;
    // 형식을 강제하지 못하는 제공자: 한 번 더 요청한다. 그래도 틀리면 호출한 쪽의 JSON 검사가 처리한다
    const again = await ask([...messages, { role: 'assistant', content: clean }, { role: 'user', content: 'That was not valid JSON. Reply again with only the JSON value.' }]);
    return extractJson(again) ?? again;
  };
  return direct ? run() : limited(cfg, run);
}

export function parseJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('JSON 배열 없음');
  const value: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error('JSON 배열 아님');
  return value;
}

// ---- 도구 호출(function calling) ----

export interface ToolCall {
  id: string;
  name: string;
  /** 모델이 준 인자(JSON 문자열을 풀어 둔 것). 형식이 틀리면 빈 객체 */
  args: Record<string, unknown>;
}

/**
 * 모델이 도구 호출을 정해진 형식이 아니라 글자로 쓴 경우(작은 모델에서 흔함)를 알아듣는다.
 *   XML:  <tool_call><function=get_quote><parameter=symbol>NVDA</parameter></function></tool_call>
 *   JSON:     <tool_call>{"name":"get_quote","arguments":{"symbol":"NVDA"}}</tool_call>
 */
export function parseInlineToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const [i, m] of [...content.matchAll(/<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g)].entries()) {
    const body = (m[1] ?? '').trim();
    const fn = body.match(/<function=([\w-]+)>([\s\S]*?)(?:<\/function>|$)/);
    if (fn?.[1]) {
      const args: Record<string, unknown> = {};
      for (const p of (fn[2] ?? '').matchAll(/<parameter=([\w-]+)>([\s\S]*?)<\/parameter>/g)) args[p[1]!] = (p[2] ?? '').trim();
      calls.push({ id: `inline-${i}`, name: fn[1], args });
      continue;
    }
    try {
      const v = JSON.parse(body) as { name?: string; arguments?: unknown };
      if (v.name) calls.push({ id: `inline-${i}`, name: v.name, args: (typeof v.arguments === 'string' ? JSON.parse(v.arguments) : v.arguments) as Record<string, unknown> ?? {} });
    } catch { /* 알아들을 수 없는 호출은 무시 */ }
  }
  return calls;
}

export const stripToolMarkup = (s: string): string => s.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, '').trim();

/** 도구를 줄 수 있는 한 번의 호출: 모델이 도구를 부르면 toolCalls, 아니면 content */
export async function chatWithTools(
  cfg: LlmConfig,
  messages: ToolMessage[],
  tools: ToolSpec[],
  { maxTokens = 1500, temperature = 0.2, timeoutMs }: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<{ content: string; toolCalls: ToolCall[]; raw: ToolMessage }> {
  const msg = await providerFor(cfg).complete(cfg, { messages, tools, maxTokens, temperature, timeoutMs: timeoutMs ?? cfg.timeoutMs });
  const content = stripThink(msg.content);
  let toolCalls: ToolCall[] = (msg.toolCalls ?? []).map((c) => {
    let args: Record<string, unknown> = {};
    try { const v: unknown = JSON.parse(c.function.arguments || '{}'); if (v && typeof v === 'object') args = v as Record<string, unknown>; } catch { /* 빈 인자 */ }
    return { id: c.id, name: c.function.name, args };
  });
  let toolCallsRaw = msg.toolCalls;
  // 글자로 쓴 도구 호출 → 정식 호출로 바꿔 대화 기록도 맞춘다(도구를 준 호출에서만)
  if (!toolCalls.length && tools.length && content.includes('<tool_call>')) {
    toolCalls = parseInlineToolCalls(content);
    toolCallsRaw = toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } }));
  }
  const clean = collapseRepeats(stripToolMarkup(content));
  return { content: clean, toolCalls, raw: { role: 'assistant', content: clean, ...(toolCallsRaw?.length ? { tool_calls: toolCallsRaw } : {}), ...(msg.providerContent ? { providerContent: msg.providerContent } : {}) } };
}
