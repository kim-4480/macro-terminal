import { describe, expect, it } from 'vitest';
import { describeScreen, parseScreen } from '../src/server/agent-screen';
import { historyToMessages, sanitizeHistory } from '../src/server/chat';
import { ToolSession } from '../src/server/chat-tools';

describe('screen state', () => {
  it('parses and describes the current screen', () => {
    expect(parseScreen({ view: 'PORT', company: null, drawer: true })).toEqual({ view: 'PORT', company: null, drawer: true });
    expect(parseScreen({ view: 'NOPE' })).toBeNull();
    expect(describeScreen({ view: 'PORT', company: null, drawer: true }, 'ko')).toBe('내 포트폴리오 (PORT) · 대화는 오른쪽 옆 창');
    expect(describeScreen({ view: 'HOME', company: 'NVDA', drawer: true }, 'en')).toBe('company page NVDA · chat in the side panel');
    expect(describeScreen({ view: 'AI', company: null, drawer: false }, 'ko')).toBe('AI 에이전트 전체 화면 (AI)');
  });
});

describe('history with tool records', () => {
  const raw = [
    { role: 'user', content: 'Open my portfolio' },
    { role: 'assistant', content: 'Your portfolio screen is now open.', tools: [{ name: 'open_screen', args: { code: 'PORT' }, summary: 'Opening screen: PORT' }] },
    { role: 'user', content: 'Open my portfolio' },
  ];

  it('keeps known tools and drops unknown or oversized ones', () => {
    const h = sanitizeHistory([
      raw[0],
      { ...raw[1], tools: [...raw[1]!.tools!, { name: 'rm_rf', args: {}, summary: 'x' }, { name: 'get_quote', args: { symbol: 'X'.repeat(600) }, summary: 'big' }] },
      raw[2],
    ]);
    expect(h[1]!.tools).toEqual([{ name: 'open_screen', args: { code: 'PORT' }, summary: 'Opening screen: PORT' }]);
  });

  it('rebuilds call → result → answer for the model', () => {
    const m = historyToMessages(sanitizeHistory(raw), 'en');
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
    expect(m[1]!.tool_calls![0]!.function).toEqual({ name: 'open_screen', arguments: '{"code":"PORT"}' });
    expect(m[2]!.tool_call_id).toBe(m[1]!.tool_calls![0]!.id);
    expect(m[3]!.content).toBe('Your portfolio screen is now open.');
  });
});

describe('citedNews', () => {
  it('returns only news refs used in the answer and marks unread ones', () => {
    const s = new ToolSession({} as never, {} as never, 'ko');
    const hit = (n: number) => ({ title: `t${n}`, publisher: 'p', url: `https://x.test/${n}`, published: null, snippet: '' });
    const news = (s as unknown as { news: Map<string, ReturnType<typeof hit>> }).news;
    news.set('N1', hit(1));
    news.set('N2', hit(2));
    news.set('N3', hit(3));
    s.register({ kind: 'article', title: 't1', url: 'https://x.test/1' }, 'body');
    const out = s.citedNews('- t1 [N1]\n- t2 [N2]\n- 없는 번호 [N9]');
    expect(out.map((x) => [x.id, x.url, x.unread])).toEqual([['N1', 'https://x.test/1', false], ['N2', 'https://x.test/2', true]]);
  });
});
