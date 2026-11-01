import { z } from 'zod';
import { LANGS } from '@/shared/languages';
import { HttpStatusError } from './api';
import { baseCurrency, loadConfig, type LlmConfig, type Portfolio, portfolioSchema, PRESETS, rawSettings, readPreset, savePortfolio, saveSettings, type Settings } from './config';
import { chat, chatWithTools } from './llm';
import { isLocalUrl, providerFor, type LlmHealth } from './llm-providers';

// 첫 실행 설정. API 키는 화면으로 내보내지 않는다(저장 여부만 알려 준다).

export interface SetupView {
  language: string;
  preset: Settings['preset'];
  baseCurrency: string;
  setupDone: boolean;
  background: boolean;
  llm: { provider: 'openai' | 'anthropic'; baseUrl: string; model: string; disableThinking: boolean; hasKey: boolean; keyFromEnv: boolean };
  hasEcosKey: boolean;
  languages: readonly string[];
}

export function setupView(): SetupView {
  const s = rawSettings();
  return {
    language: s.language,
    preset: s.preset,
    baseCurrency: baseCurrency(),
    setupDone: s.setupDone,
    background: s.automation.background,
    llm: { provider: s.llm.provider, baseUrl: s.llm.baseUrl, model: s.llm.model, disableThinking: s.llm.disableThinking, hasKey: !!s.llm.apiKey, keyFromEnv: !!process.env.LLM_API_KEY },
    hasEcosKey: !!s.ecosApiKey,
    languages: LANGS,
  };
}

const llmInput = z.object({
  provider: z.enum(['openai', 'anthropic']),
  baseUrl: z.url().transform((u) => u.replace(/\/+$/, '')),
  model: z.string(),
  /** 비우면 저장된 키를 유지한다 */
  apiKey: z.string().default(''),
  disableThinking: z.boolean().default(false),
});

const saveInput = z.object({
  language: z.string(),
  preset: z.enum(PRESETS),
  baseCurrency: z.string(),
  background: z.boolean(),
  ecosApiKey: z.string().default(''),
  llm: llmInput.extend({ model: z.string().min(1) }),
});

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpStatusError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

/** 저장된 키는 저장 때와 같은 서버로만 보낸다(주소를 바꾸면 다른 회사로 키가 나갈 수 있다) */
function keptKey(input: { provider: string; baseUrl: string; apiKey: string }, s: Settings): string {
  if (input.apiKey) return input.apiKey;
  return input.provider === s.llm.provider && input.baseUrl === s.llm.baseUrl ? s.llm.apiKey : '';
}

export function saveSetup(raw: unknown): SetupView {
  const input = parse(saveInput, raw);
  const current = rawSettings();
  // 구성을 바꿔도 사용자가 추가한 거시 지표는 그대로 둔다
  const base = input.preset === current.preset ? current : { ...current, ...(readPreset(input.preset).settings as Partial<Settings>), macro: current.macro };
  saveSettings({
    ...base,
    language: input.language,
    preset: input.preset,
    baseCurrency: input.baseCurrency,
    setupDone: true,
    ecosApiKey: input.ecosApiKey || current.ecosApiKey,
    automation: { background: input.background },
    briefing: { autoOnStartup: input.background, periodicAutoOnStartup: input.background },
    llm: { ...current.llm, ...input.llm, apiKey: keptKey(input.llm, current) },
  });
  // 포트폴리오는 아직 예시일 때만 프리셋을 따른다
  if (input.preset !== current.preset) {
    const portfolio: Portfolio = portfolioSchema.parse(readPreset(input.preset).portfolio);
    if (currentIsExample()) savePortfolio(portfolio);
  }
  return setupView();
}

function currentIsExample(): boolean {
  try {
    return loadConfig().portfolio.example;
  } catch {
    return false; // 읽지 못하는 포트폴리오를 덮어쓰지 않는다
  }
}

export interface ProbeResult {
  reason: LlmHealth;
  models: string[];
  local: boolean;
  /** 기능별 결과. 연결이 안 되거나 모델이 없으면 시험하지 않는다 */
  checks: { chat: string | null; json: string | null; tools: string | null } | null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

async function check(fn: () => Promise<boolean>): Promise<string | null> {
  try {
    return (await fn()) ? null : 'unexpected reply';
  } catch (err) {
    return errorText(err);
  }
}

/** 연결 시험: 이 앱이 쓰는 세 가지(답변, 구조화 출력, 도구 호출)를 작은 요청으로 확인한다 */
export async function probeLlm(raw: unknown): Promise<ProbeResult> {
  const input = parse(llmInput, raw);
  const cfg: LlmConfig = { ...rawSettings().llm, ...input, apiKey: keptKey(input, rawSettings()) || process.env.LLM_API_KEY || '' };
  const status = await providerFor(cfg).status(cfg);
  const base = { reason: status.reason, models: status.models ?? [], local: isLocalUrl(cfg.baseUrl) };
  if (!status.online || !cfg.model) return { ...base, checks: null };
  const opts = { direct: true, maxTokens: 60, temperature: 0, timeoutMs: 120_000 };
  return {
    ...base,
    checks: {
      chat: await check(async () => !!(await chat(cfg, [{ role: 'user', content: 'Reply with the word OK.' }], opts)).trim()),
      json: await check(async () => {
        const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
        const out = await chat(cfg, [{ role: 'user', content: 'Return a JSON object with ok set to true.' }], { ...opts, schema });
        return typeof (JSON.parse(out) as { ok?: unknown }).ok === 'boolean';
      }),
      tools: await check(async () => {
        const tool = { name: 'get_time', description: 'Returns the current time.', parameters: { type: 'object', properties: {} } };
        const out = await chatWithTools(cfg, [{ role: 'user', content: 'What time is it? Use the tool.' }], [tool], { maxTokens: 200, temperature: 0, timeoutMs: 120_000 });
        return out.toolCalls.some((c) => c.name === 'get_time');
      }),
    },
  };
}
