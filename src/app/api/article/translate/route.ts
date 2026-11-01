import { assertSameOrigin, HttpStatusError, pickLang, route } from '@/server/api';
import { articleView, parseArticleHint } from '@/server/article-view';
import { translateArticle } from '@/server/article-translate';
import type { ArticleTranslation } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 기사 본문 번역(백그라운드). 화면이 이 주소를 계속 부르는 동안 이어서 하고, 끝난 문단부터 돌려준다 */
export const POST = route(async ({ req, settings }): Promise<ArticleTranslation> => {
  assertSameOrigin(req);
  const body = (await req.json().catch(() => ({}))) as { link?: unknown; lang?: string; retry?: unknown; title?: unknown; articleLang?: string };
  const link = typeof body.link === 'string' ? body.link.trim() : '';
  if (!/^https?:\/\//.test(link) || link.length > 2000) throw new HttpStatusError(400, '기사 주소가 필요합니다');
  // 본문은 화면이 보낸 글이 아니라 서버가 읽은 글을 쓴다
  const article = await articleView(link, parseArticleHint(body.title, body.articleLang));
  if (!article.text) throw new HttpStatusError(404, '번역할 본문이 없습니다');
  return translateArticle(settings, article.text, pickLang(body.lang), body.retry === true);
});
