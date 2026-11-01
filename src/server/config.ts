import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_LANG, isLang, LANGS } from '@/shared/languages';
import { CONFIG_DIR } from './paths';

// config/*.json 형식. 잘못 고치면 어느 항목이 틀렸는지 화면에 알려준다.

const topicSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  labelEn: z.string().optional(),
  en: z.array(z.string()).default([]),
  ko: z.array(z.string()).default([]),
});

export const PRESETS = ['global', 'korea'] as const;
export type PresetName = (typeof PRESETS)[number];

const llmSchema = z.object({
  /** openai: /chat/completions 형식(로컬 서버 대부분 포함), anthropic: Claude Messages API */
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().default(''),
  /** llama-server 처럼 chat_template_kwargs 를 받는 서버에서 모델의 생각 단계를 끈다 */
  disableThinking: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(600_000),
  /** 동시 호출 수. 비우면 로컬 1, 원격 4 */
  maxConcurrent: z.number().int().positive().optional(),
});

const LLM_DEFAULT = { provider: 'openai' as const, baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', apiKey: '', disableThinking: false, timeoutMs: 600_000 };

const settingsSchema = z.object({
  language: z.string().refine(isLang, { message: `지원 언어: ${LANGS.join(', ')}` }).default(DEFAULT_LANG),
  /** 첫 실행 설정 화면을 마쳤는지 */
  setupDone: z.boolean().default(false),
  preset: z.enum(PRESETS).default('global'),
  /** 평가액·손익을 환산해 보여 주는 통화. 매매 기록 환율이 이 통화 기준이므로 기록이 쌓인 뒤에는 바꾸지 않는다 */
  baseCurrency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 통화 코드(USD, KRW 등)여야 합니다').default('USD'),
  llm: llmSchema.default(LLM_DEFAULT),
  /** 사용자가 누르지 않아도 모델을 부르는 일(뉴스 번역·요약, 지도 태깅, 사업 설명 번역). 원격 API 면 요금이 나간다 */
  automation: z.object({ background: z.boolean().default(false) }).default({ background: false }),
  /** 접속하지 않을 외부 데이터 호스트(예: www.bing.com). 그 소스를 쓰는 기능은 데이터 없이 동작한다 */
  blockedHosts: z.array(z.string()).default([]),
  ecosApiKey: z.string().default(''),
  briefing: z.object({
    autoOnStartup: z.boolean().default(false),
    /** 주간·월간: 마지막 것이 7일·30일보다 오래됐으면 시작할 때 만든다 */
    periodicAutoOnStartup: z.boolean().default(false),
  }).default({ autoOnStartup: false, periodicAutoOnStartup: false }),
  macro: z.array(z.object({
    group: z.string(),
    groupEn: z.string().optional(),
    id: z.string().regex(/^(fred|ecos|imf|yahoo|csv):.+/, 'fred:… / ecos:… / imf:… / yahoo:… / csv:… 형식이어야 합니다'),
    label: z.string(),
    labelEn: z.string().optional(),
    unit: z.string().default(''),
    transform: z.enum(['yoy']).optional(),
  })),
  markets: z.array(z.object({ symbol: z.string(), label: z.string(), labelEn: z.string().optional() })),
  curve: z.array(z.string()),
  /** 상단 주요 지표 띠: 시계열 id(yahoo:… / fred:… / ecos:… / imf:… / csv:…) */
  strip: z.array(z.string().regex(/^(fred|ecos|imf|yahoo|csv):.+/)).default([]),
  news: z.object({
    days: z.number().int().positive().default(3),
    perTopic: z.number().int().positive().default(12),
    general: z.array(topicSchema).default([]),
  }),
});

export const portfolioSchema = z.object({
  example: z.boolean().default(false),
  note: z.string().optional(),
  industries: z.array(topicSchema.extend({ benchmark: z.string().optional() })).default([]),
  holdings: z.array(z.object({
    symbol: z.string().min(1),
    name: z.string().optional(),
    nameEn: z.string().optional(),
    industry: z.string(),
    qty: z.number().positive().optional(),
  })).default([]),
});

export type Settings = z.infer<typeof settingsSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type MacroItem = Settings['macro'][number];
export type TopicConfig = z.infer<typeof topicSchema> & { benchmark?: string };
export type LlmConfig = Settings['llm'];

export class ConfigError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

/** 실제 설정은 Git 에 넣지 않는다. 없으면 프리셋에서 만든다 */
function ensureFile(file: string, preset: string): void {
  const target = path.join(CONFIG_DIR, file);
  if (!existsSync(target)) copyFileSync(path.join(CONFIG_DIR, 'presets', preset), target);
}

export function readPreset(name: PresetName): { settings: unknown; portfolio: unknown } {
  const load = (f: string): unknown => JSON.parse(readFileSync(path.join(CONFIG_DIR, 'presets', f), 'utf8'));
  return { settings: load(`${name}.settings.json`), portfolio: load(`${name}.portfolio.json`) };
}

function read<T>(file: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(CONFIG_DIR, file), 'utf8'));
  } catch (err) {
    throw new ConfigError(`config/${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`config/${file}\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

// .env 값이 있으면 settings.json 보다 우선(키는 .env 에 두는 것을 권장)
function applyEnv(s: Settings): Settings {
  const e = process.env;
  return {
    ...s,
    ecosApiKey: e.ECOS_API_KEY || s.ecosApiKey,
    llm: {
      ...s.llm,
      provider: e.LLM_PROVIDER === 'anthropic' || e.LLM_PROVIDER === 'openai' ? e.LLM_PROVIDER : s.llm.provider,
      baseUrl: e.LLM_BASE_URL || s.llm.baseUrl,
      model: e.LLM_MODEL || s.llm.model,
      apiKey: e.LLM_API_KEY || s.llm.apiKey,
    },
  };
}

/**
 * 화면의 포트폴리오 편집기에서 저장. 검증 → 이전 파일을 portfolio.json.bak 으로 보관 → 임시 파일에 쓰고 교체.
 * 업계 id 중복·없는 업계를 가리키는 종목은 거부한다.
 */
export function savePortfolio(raw: unknown): Portfolio {
  const parsed = portfolioSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(z.prettifyError(parsed.error), 400);
  const p = parsed.data;
  const ids = new Set<string>();
  for (const ind of p.industries) {
    if (ids.has(ind.id)) throw new ConfigError(`업계 id 가 중복됩니다: ${ind.id}`, 400);
    ids.add(ind.id);
  }
  const symbols = new Set<string>();
  for (const h of p.holdings) {
    if (!ids.has(h.industry)) throw new ConfigError(`${h.symbol}: 없는 업계(${h.industry})`, 400);
    if (symbols.has(h.symbol)) throw new ConfigError(`종목이 중복됩니다: ${h.symbol}`, 400);
    symbols.add(h.symbol);
  }
  const file = path.join(CONFIG_DIR, 'portfolio.json');
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(p, null, 2)}\n`);
  renameSync(tmp, file);
  return p;
}

/** 설정 화면에서 저장. 검증 후 임시 파일에 쓰고 교체하며, API 키가 들어가므로 소유자만 읽게 한다 */
export function saveSettings(raw: unknown): Settings {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(z.prettifyError(parsed.error), 400);
  const file = path.join(CONFIG_DIR, 'settings.json');
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(parsed.data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return parsed.data;
}

/** .env 를 덮어쓰지 않은 저장용 원본 설정 */
export function rawSettings(): Settings {
  ensureFile('settings.json', 'global.settings.json');
  return read('settings.json', settingsSchema);
}

/** 기준 통화(설정을 못 읽으면 USD) */
export function baseCurrency(): string {
  try {
    return rawSettings().baseCurrency;
  } catch {
    return 'USD';
  }
}

/** 요청마다 다시 읽는다 → 설정을 고치면 재시작 없이 반영 */
export function loadConfig(): { settings: Settings; portfolio: Portfolio } {
  ensureFile('settings.json', 'global.settings.json');
  ensureFile('portfolio.json', 'global.portfolio.json');
  return {
    settings: applyEnv(read('settings.json', settingsSchema)),
    portfolio: read('portfolio.json', portfolioSchema),
  };
}
