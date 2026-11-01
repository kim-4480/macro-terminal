import { assertSameOrigin, HttpStatusError, route } from '@/server/api';
import { articleView, parseArticleHint } from '@/server/article-view';
import type { ArticleView } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ req }): Promise<ArticleView> => {
  assertSameOrigin(req);
  const body = (await req.json().catch(() => ({}))) as { link?: unknown; title?: unknown; lang?: string };
  const link = typeof body.link === 'string' ? body.link.trim() : '';
  if (!/^https?:\/\//.test(link) || link.length > 2000) throw new HttpStatusError(400, '기사 주소가 필요합니다');
  return articleView(link, parseArticleHint(body.title, body.lang));
});
