import { NextResponse } from 'next/server';
import type { AgentDecision, ChatEvent } from '@/shared/types';
import { parseScreen } from '@/server/agent-screen';
import { assertSameOrigin, pickLang } from '@/server/api';
import { ChatInputError, resumeChat, runChat, sanitizeHistory } from '@/server/chat';
import { ConfigError, loadConfig } from '@/server/config';
import { llmStatus } from '@/server/llm';
import { errorMessage } from '@/server/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 질문 → 진행 상황·근거·승인 요청·답·검증 결과를 줄마다 JSON 하나(NDJSON)로 흘려보낸다.
 * { resume: 결정 } 이면 승인 카드의 결정으로 멈췄던 에이전트를 이어 간다.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { settings, portfolio } = loadConfig();
    assertSameOrigin(req);
    const body = (await req.json().catch(() => ({}))) as { messages?: unknown; lang?: string; resume?: unknown; screen?: unknown; chatId?: unknown };
    const decision = parseDecision(body.resume);
    const history = decision ? [] : sanitizeHistory(body.messages);
    if (!(await llmStatus(settings.llm)).online) {
      return NextResponse.json({ error: 'LLM offline: check /setup' }, { status: 503 });
    }
    const lang = pickLang(body.lang);
    const screen = parseScreen(body.screen);
    const chatId = typeof body.chatId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.chatId) ? body.chatId : null;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        try {
          const events = decision ? resumeChat(decision, req.signal, screen) : runChat(settings, portfolio, history, lang, req.signal, screen, chatId);
          for await (const e of events) send(e);
        } catch (err) {
          if (!req.signal.aborted) send({ t: 'error', text: errorMessage(err) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err instanceof ChatInputError ? 400 : err instanceof ConfigError ? 500 : (err as { status?: number }).status ?? 502;
    return NextResponse.json({ error: errorMessage(err) }, { status });
  }
}

function parseDecision(raw: unknown): AgentDecision | null {
  if (raw == null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.approved !== 'boolean') throw new ChatInputError('resume 형식이 틀렸습니다');
  return {
    id: o.id,
    approved: o.approved,
    qty: typeof o.qty === 'number' ? o.qty : null,
    industry: typeof o.industry === 'string' ? o.industry : null,
  };
}
