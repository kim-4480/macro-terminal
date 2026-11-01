import { assertSameOrigin, HttpStatusError, route } from '@/server/api';
import { deleteChat, listChats, saveChat, validChat } from '@/server/journal/chats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 대화 세션 목록 */
export const GET = route(() => ({ chats: listChats() }));

/** { chats: [...] } 저장(있으면 덮어씀), { delete: id } 삭제 */
export const POST = route(async ({ req }) => {
  assertSameOrigin(req);
  const body = (await req.json().catch(() => ({}))) as { chats?: unknown; delete?: unknown };
  if (typeof body.delete === 'string') { deleteChat(body.delete); return { ok: true }; }
  if (!Array.isArray(body.chats)) throw new HttpStatusError(400, 'chats 배열이 필요합니다');
  const chats = body.chats.map(validChat);
  if (chats.some((c) => !c)) throw new HttpStatusError(400, '대화 형식이 틀렸습니다');
  for (const c of chats) saveChat(c!);
  return { ok: true, saved: chats.length };
});
