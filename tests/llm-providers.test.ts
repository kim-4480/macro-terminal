import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@/server/config';
import { extractJson } from '@/server/llm';
import { adjustmentFor, closeSchema, isLocalUrl, openaiBody, toAnthropicMessages, type Adjustment, type CompletionRequest } from '@/server/llm-providers';

const cfg: LlmConfig = { provider: 'openai', baseUrl: 'http://x/v1', model: 'm', apiKey: '', disableThinking: true, timeoutMs: 1000 };
const req: CompletionRequest = { messages: [{ role: 'user', content: 'hi', providerContent: [{ type: 'text' }] }], maxTokens: 10, temperature: 0.2, timeoutMs: 1000, schema: { type: 'object' } };

describe('OpenAI 호환 요청 맞추기', () => {
  it('sends the full request when nothing was rejected', () => {
    const b = openaiBody(cfg, req, new Set());
    expect(b).toMatchObject({ max_tokens: 10, temperature: 0.2, chat_template_kwargs: { enable_thinking: false } });
    expect(b.response_format).toBeDefined();
    expect((b.messages as object[])[0]).toEqual({ role: 'user', content: 'hi' }); // 제공자 전용 항목은 보내지 않는다
  });

  it('applies adjustments', () => {
    const b = openaiBody(cfg, req, new Set<Adjustment>(['max_completion_tokens', 'no_temperature', 'no_thinking_kwargs', 'no_response_format']));
    expect(b.max_completion_tokens).toBe(10);
    expect(b.max_tokens).toBeUndefined();
    expect(b.temperature).toBeUndefined();
    expect(b.chat_template_kwargs).toBeUndefined();
    expect(b.response_format).toBeUndefined();
    expect((b.messages as { content: string }[])[0]!.content).toContain('JSON Schema');
  });

  it('reads rejected parameters from 400 errors, one at a time', () => {
    const body = "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.";
    expect(adjustmentFor(400, body, new Set())).toBe('max_completion_tokens');
    expect(adjustmentFor(400, body, new Set<Adjustment>(['max_completion_tokens']))).toBeNull();
    expect(adjustmentFor(400, "Unrecognized request argument: chat_template_kwargs", new Set())).toBe('no_thinking_kwargs');
    expect(adjustmentFor(400, "'temperature' does not support 0.2", new Set())).toBe('no_temperature');
    expect(adjustmentFor(500, 'temperature', new Set())).toBeNull();
    expect(adjustmentFor(401, 'bad key', new Set())).toBeNull();
  });
});

describe('Anthropic 형식 변환', () => {
  it('moves system out and groups tool results into one user message', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'looking', tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: '{"x":1}' } }, { id: 'b', type: 'function', function: { name: 'g', arguments: 'broken' } }] },
      { role: 'tool', tool_call_id: 'a', content: '1' },
      { role: 'tool', tool_call_id: 'b', content: '2' },
      { role: 'user', content: 'more' },
    ]);
    expect(system).toBe('S');
    expect(messages).toHaveLength(4);
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'looking' }, { type: 'tool_use', id: 'a', name: 'f', input: { x: 1 } }, { type: 'tool_use', id: 'b', name: 'g', input: {} }]);
    expect(messages[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'a', content: '1' }, { type: 'tool_result', tool_use_id: 'b', content: '2' }]);
  });

  it('replays the original blocks when available and skips empty text', () => {
    const blocks = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'a', name: 'f', input: {} }];
    const { messages } = toAnthropicMessages([{ role: 'user', content: 'Q' }, { role: 'assistant', content: '', providerContent: blocks }, { role: 'assistant', content: '' }]);
    expect(messages).toEqual([{ role: 'user', content: 'Q' }, { role: 'assistant', content: blocks }]);
  });

  it('closes every object in a schema but leaves enums alone', () => {
    expect(closeSchema({ type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: {} } }, b: { type: 'string', enum: ['object'] } } })).toEqual({
      type: 'object', additionalProperties: false,
      properties: { a: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {} } }, b: { type: 'string', enum: ['object'] } },
    });
  });
});

describe('extractJson', () => {
  it('finds JSON in fences and prose', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Here you go: [1,2] done')).toBe('[1,2]');
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('isLocalUrl', () => {
  it('separates this machine and private networks from the internet', () => {
    for (const u of ['http://127.0.0.1:8080/v1', 'http://localhost:11434', 'http://192.168.1.5:1234', 'http://[::1]:8080', 'http://10.0.0.2']) expect(isLocalUrl(u)).toBe(true);
    for (const u of ['https://api.openai.com/v1', 'https://api.anthropic.com', 'not a url', 'http://172.32.0.1']) expect(isLocalUrl(u)).toBe(false);
  });
});
