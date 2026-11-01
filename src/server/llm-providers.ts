import Anthropic from '@anthropic-ai/sdk';
import type { LlmConfig } from './config';

// LLM 제공자 경계. 호출하는 쪽은 llm.ts 만 보고, 제공자마다 다른 요청 형식은 여기서 맞춘다.
//  openai:    /chat/completions 형식 (llama-server, Ollama, LM Studio, OpenAI, Gemini 호환 주소, OpenRouter 등)
//  anthropic: Claude Messages API

export interface ToolMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  /** 제공자가 준 답 원본. 도구 호출 다음 요청에 그대로 돌려줘야 하는 제공자용 */
  providerContent?: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ToolMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  temperature: number;
  schema?: Record<string, unknown>;
  timeoutMs: number;
}

export interface Completion {
  content: string;
  toolCalls?: ToolMessage['tool_calls'];
  providerContent?: unknown;
}

export type LlmHealth = 'ok' | 'unreachable' | 'auth' | 'error';

export interface LlmStatus {
  online: boolean;
  reason: LlmHealth;
  models?: string[];
}

interface Provider {
  complete(cfg: LlmConfig, req: CompletionRequest): Promise<Completion>;
  status(cfg: LlmConfig): Promise<LlmStatus>;
}

const STATUS_TIMEOUT_MS = 5000;

// ---- OpenAI 호환 ----

/** 서버가 거부한 요청 항목을 알아내 다음 요청부터 맞춘다(서버·모델마다 받는 항목이 다르다) */
export type Adjustment = 'max_completion_tokens' | 'no_temperature' | 'no_thinking_kwargs' | 'no_response_format';

export function adjustmentFor(status: number, body: string, applied: ReadonlySet<Adjustment>): Adjustment | null {
  if (status !== 400 && status !== 422) return null;
  const b = body.toLowerCase();
  const options: [Adjustment, boolean][] = [
    ['no_thinking_kwargs', b.includes('chat_template_kwargs')],
    ['max_completion_tokens', b.includes('max_completion_tokens') || b.includes('max_tokens')],
    ['no_response_format', b.includes('response_format') || b.includes('json_schema')],
    ['no_temperature', b.includes('temperature')],
  ];
  return options.find(([a, hit]) => hit && !applied.has(a))?.[0] ?? null;
}

const g = globalThis as typeof globalThis & { __llmAdjustments?: Map<string, Set<Adjustment>> };
const adjustments = (g.__llmAdjustments ??= new Map());

export function openaiBody(cfg: LlmConfig, req: CompletionRequest, applied: ReadonlySet<Adjustment>): Record<string, unknown> {
  const noFormat = !!req.schema && applied.has('no_response_format');
  const messages = req.messages.map(({ role, content, tool_calls, tool_call_id }) => ({ role, content, ...(tool_calls ? { tool_calls } : {}), ...(tool_call_id ? { tool_call_id } : {}) }));
  if (noFormat) messages.unshift({ role: 'system', content: `Reply with only a JSON value matching this JSON Schema, with no other text:\n${JSON.stringify(req.schema)}` });
  return {
    model: cfg.model,
    messages,
    stream: false,
    [applied.has('max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens']: req.maxTokens,
    ...(applied.has('no_temperature') ? {} : { temperature: req.temperature }),
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) } : {}),
    ...(req.schema && !noFormat ? { response_format: { type: 'json_schema', json_schema: { name: 'out', schema: req.schema } } } : {}),
    ...(cfg.disableThinking && !applied.has('no_thinking_kwargs') ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
}

const openaiHeaders = (cfg: LlmConfig): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
});

const openai: Provider = {
  async complete(cfg, req) {
    const key = `${cfg.baseUrl}|${cfg.model}`;
    const applied = adjustments.get(key) ?? new Set<Adjustment>();
    for (;;) {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: openaiHeaders(cfg),
        body: JSON.stringify(openaiBody(cfg, req, applied)),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text();
        const next = adjustmentFor(res.status, body, applied);
        if (!next) throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
        applied.add(next);
        adjustments.set(key, applied);
        continue;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolMessage['tool_calls'] } }[] };
      const msg = json.choices?.[0]?.message ?? {};
      return { content: msg.content ?? '', toolCalls: msg.tool_calls };
    }
  },
  async status(cfg) {
    try {
      const res = await fetch(`${cfg.baseUrl}/models`, { headers: openaiHeaders(cfg), signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
      if (res.status === 401 || res.status === 403) return { online: false, reason: 'auth' };
      // 모델 목록을 제공하지 않는 서버도 있다: 응답이 왔으면 켜진 것으로 본다
      if (res.status === 404 || res.status === 405) return { online: true, reason: 'ok' };
      if (!res.ok) return { online: false, reason: 'error' };
      const json = (await res.json()) as { data?: { id?: string; name?: string }[]; models?: { id?: string; name?: string }[] };
      return { online: true, reason: 'ok', models: (json.data ?? json.models ?? []).map((m) => m.id || m.name || '?') };
    } catch {
      return { online: false, reason: 'unreachable' };
    }
  },
};

// ---- Anthropic ----

// 요청마다 생각에 쓰는 토큰도 max_tokens 에 포함된다. 짧은 분류 요청이 생각만 하다 잘리지 않게 바닥을 둔다.
const ANTHROPIC_MIN_MAX_TOKENS = 4096;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

/** 구조화 출력은 모든 object 에 additionalProperties:false 를 요구한다 */
export function closeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, k === 'enum' || k === 'required' ? v : closeSchema(v)]));
  return out.type === 'object' ? { additionalProperties: false, ...out } : out;
}

/** 공통 대화 형식 → Messages API 형식. 이어진 도구 결과는 한 사용자 메시지에 묶는다 */
export function toAnthropicMessages(messages: ToolMessage[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: m.content };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.providerContent) {
      out.push({ role: 'assistant', content: m.providerContent as Anthropic.ContentBlockParam[] });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.tool_calls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.function.name, input: safeArgs(c.function.arguments) })),
        ],
      });
    } else if (m.content) {
      out.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
  }
  return { system, messages: out };
}

function safeArgs(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const anthropicClient = (cfg: LlmConfig, timeout: number) => new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl, timeout });

const anthropic: Provider = {
  async complete(cfg, req) {
    const { system, messages } = toAnthropicMessages(req.messages);
    const params = {
      model: cfg.model,
      max_tokens: Math.max(req.maxTokens, ANTHROPIC_MIN_MAX_TOKENS),
      messages,
      ...(system ? { system } : {}),
      cache_control: { type: 'ephemeral' as const },
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })) } : {}),
      ...(req.schema ? { output_config: { format: { type: 'json_schema' as const, schema: closeSchema(req.schema) as Record<string, unknown> } } } : {}),
    };
    const client = anthropicClient(cfg, req.timeoutMs);
    const plain = () => client.messages.create(params as Anthropic.MessageCreateParamsNonStreaming);
    // 지원하는 모델은 안전 분류기가 거절하면 서버가 다른 모델로 이어 가게 한다. 받지 않는 계정·경로면 그냥 보낸다
    const withFallback = async () => {
      try {
        return await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } as unknown as Parameters<typeof client.beta.messages.create>[0]) as unknown as Anthropic.Message;
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) return plain();
        throw err;
      }
    };
    const response = FALLBACK_MODELS.test(cfg.model) ? await withFallback() : await plain();
    if (response.stop_reason === 'refusal') throw new Error('LLM refused the request');
    const blocks = response.content;
    return {
      content: blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
      toolCalls: blocks.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input) } }] : [])),
      providerContent: blocks,
    };
  },
  async status(cfg) {
    try {
      const page = await anthropicClient(cfg, STATUS_TIMEOUT_MS).models.list({ limit: 100 });
      return { online: true, reason: 'ok', models: page.data.map((m) => m.id) };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { online: false, reason: 'auth' };
      if (err instanceof Anthropic.APIConnectionError) return { online: false, reason: 'unreachable' };
      return { online: false, reason: 'error' };
    }
  },
};

export const providerFor = (cfg: LlmConfig): Provider => (cfg.provider === 'anthropic' ? anthropic : openai);

/** 이 컴퓨터나 사설망의 서버인지(프롬프트가 외부로 나가지 않는지) */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/.test(h);
  } catch {
    return false;
  }
}
