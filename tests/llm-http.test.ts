import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LlmConfig } from '@/server/config';
import { chat, chatWithTools, llmStatus, type ToolMessage } from '@/server/llm';

// 실제 서버처럼 HTTP 로 주고받아 제공자별 요청·응답 형식을 확인한다.

type Handler = (path: string, body: Record<string, unknown>, headers: Record<string, string | string[] | undefined>) => { status?: number; json: unknown };

let server: Server;
let url = '';
let handler: Handler;
let requests: { path: string; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString(); });
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({ path: req.url ?? '', body, headers: req.headers });
      const { status = 200, json } = handler(req.url ?? '', body, req.headers);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => { requests = []; });

const reply = (content: unknown, extra = {}) => ({ json: { choices: [{ message: { content, ...extra } }] } });
const openaiCfg = (model: string, over: Partial<LlmConfig> = {}): LlmConfig => ({ provider: 'openai', baseUrl: `${url}/v1`, model, apiKey: 'k', disableThinking: false, timeoutMs: 5000, ...over });
const anthropicCfg = (model: string): LlmConfig => ({ provider: 'anthropic', baseUrl: url, model, apiKey: 'k', disableThinking: false, timeoutMs: 5000 });

describe('OpenAI 호환 서버', () => {
  it('adapts to a strict server and remembers it', async () => {
    handler = (_p, b) => {
      if ('max_tokens' in b) return { status: 400, json: { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens'." } } };
      if ('temperature' in b) return { status: 400, json: { error: { message: "'temperature' is not supported" } } };
      if ('chat_template_kwargs' in b) return { status: 400, json: { error: { message: 'Unrecognized argument: chat_template_kwargs' } } };
      return reply('hello');
    };
    const cfg = openaiCfg('strict', { disableThinking: true });
    expect(await chat(cfg, [{ role: 'user', content: 'q' }], { direct: true })).toBe('hello');
    expect(requests).toHaveLength(4);
    requests = [];
    await chat(cfg, [{ role: 'user', content: 'q' }], { direct: true });
    expect(requests).toHaveLength(1);
  });

  it('gets JSON from a server without structured output', async () => {
    handler = (_p, b) => ('response_format' in b ? { status: 400, json: { error: { message: 'response_format is not supported' } } } : reply('Sure!\n```json\n{"ok":true}\n```'));
    const out = await chat(openaiCfg('nojson'), [{ role: 'user', content: 'q' }], { direct: true, schema: { type: 'object' } });
    expect(JSON.parse(out)).toEqual({ ok: true });
  });

  it('asks once more when the reply is not JSON', async () => {
    let n = 0;
    handler = () => reply(n++ ? '{"ok":1}' : 'not json');
    expect(await chat(openaiCfg('retry'), [{ role: 'user', content: 'q' }], { direct: true, schema: { type: 'object' } })).toBe('{"ok":1}');
    expect(requests).toHaveLength(2);
  });

  it('passes tool calls through and does not send provider-only fields', async () => {
    const calls = [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }];
    handler = () => reply(null, { tool_calls: calls });
    const out = await chatWithTools(openaiCfg('tools'), [{ role: 'user', content: 'q', providerContent: ['x'] }], [{ name: 'f', description: 'd', parameters: { type: 'object' } }]);
    expect(out.toolCalls).toEqual([{ id: 'c1', name: 'f', args: { a: 1 } }]);
    expect(JSON.stringify(requests[0]!.body)).not.toContain('providerContent');
    expect(requests[0]!.headers.authorization).toBe('Bearer k');
  });

  it('tells a rejected key from a server that is off', async () => {
    handler = () => ({ status: 401, json: {} });
    expect(await llmStatus({ ...openaiCfg('s1'), apiKey: 'bad' })).toEqual({ online: false, reason: 'auth' });
    handler = () => ({ json: { data: [{ id: 'm1' }] } });
    expect(await llmStatus({ ...openaiCfg('s2'), apiKey: 'good' })).toEqual({ online: true, reason: 'ok', models: ['m1'] });
    expect(await llmStatus({ ...openaiCfg('s3'), baseUrl: 'http://127.0.0.1:9/v1' })).toEqual({ online: false, reason: 'unreachable' });
  });
});

describe('Anthropic', () => {
  const message = (content: unknown[], stop_reason = 'end_turn') => ({ json: { id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });

  it('sends a Messages request without sampling parameters', async () => {
    handler = () => message([{ type: 'text', text: 'hi' }]);
    expect(await chat(anthropicCfg('claude-haiku-5-5'), [{ role: 'system', content: 'S' }, { role: 'user', content: 'q' }], { direct: true, maxTokens: 50, temperature: 0.1 })).toBe('hi');
    const { path, body, headers } = requests[0]!;
    expect(path).toBe('/v1/messages');
    expect(headers.authorization).toBe('Bearer k');
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', system: 'S', max_tokens: 4096, messages: [{ role: 'user', content: 'q' }] });
    expect(body.temperature).toBeUndefined();
  });

  it('asks for structured output with closed objects', async () => {
    handler = () => message([{ type: 'text', text: '{"ok":true}' }]);
    await chat(anthropicCfg('claude-haiku-5-5'), [{ role: 'user', content: 'q' }], { direct: true, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } });
    expect(requests[0]!.body.output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } }, required: ['ok'] } } });
  });

  it('replays original blocks in the tool loop', async () => {
    const blocks = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'u1', name: 'f', input: { a: 1 } }];
    handler = () => message(blocks, 'tool_use');
    const tool = { name: 'f', description: 'd', parameters: { type: 'object', properties: {} } };
    const first = await chatWithTools(anthropicCfg('claude-haiku-5-5'), [{ role: 'user', content: 'q' }], [tool]);
    expect(first.toolCalls).toEqual([{ id: 'u1', name: 'f', args: { a: 1 } }]);
    expect((requests[0]!.body.tools as { input_schema: unknown }[])[0]!.input_schema).toEqual(tool.parameters);
    handler = () => message([{ type: 'text', text: 'done' }]);
    const history: ToolMessage[] = [{ role: 'user', content: 'q' }, first.raw, { role: 'tool', tool_call_id: 'u1', content: 'r' }];
    expect((await chatWithTools(anthropicCfg('claude-haiku-5-5'), history, [tool])).content).toBe('done');
    expect((requests[1]!.body.messages as unknown[])[1]).toEqual({ role: 'assistant', content: blocks });
    expect((requests[1]!.body.messages as unknown[])[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'r' }] });
  });

  it('uses server-side fallback on supported models and retries without it when rejected', async () => {
    handler = (_p, b) => ('fallbacks' in b ? { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: not available' } } } : message([{ type: 'text', text: 'plain' }]));
    expect(await chat(anthropicCfg('claude-opus-5-5'), [{ role: 'user', content: 'q' }], { direct: true })).toBe('plain');
    expect(requests[0]!.body.fallbacks).toBe('default');
    expect(requests[0]!.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
  });

  it('reports refusals as errors and a bad key as auth', async () => {
    handler = () => message([], 'refusal');
    await expect(chat(anthropicCfg('claude-haiku-5-5'), [{ role: 'user', content: 'q' }], { direct: true })).rejects.toThrow('refused');
    handler = () => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'bad' } } });
    expect(await llmStatus({ ...anthropicCfg('m'), apiKey: 'bad2' })).toEqual({ online: false, reason: 'auth' });
  });
});
