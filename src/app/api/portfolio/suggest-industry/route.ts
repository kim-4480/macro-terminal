import { assertSameOrigin, HttpStatusError, route } from '@/server/api';
import { suggestIndustry } from '@/server/industry-suggest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 편집기: 업계 이름 → 영어 이름·대표 지표·뉴스 검색어 제안 */
export const POST = route(async ({ settings, req }) => {
  assertSameOrigin(req);
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > 40) throw new HttpStatusError(400, '업계 이름(40자 이내)이 필요합니다');
  return suggestIndustry(settings, label);
});
