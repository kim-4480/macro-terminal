import { pickLang, route } from '@/server/api';
import { companyBriefJob, generateCompanyBriefing, targetKey } from '@/server/company';
import { targetFromUrl } from '@/server/company-target';
import { jobState } from '@/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 회사 브리핑 생성 시작(결과는 GET /api/company 의 briefing 으로 받는다) */
export const POST = route(({ settings, portfolio, url }) => {
  const target = targetFromUrl(url);
  const lang = pickLang(url.searchParams.get('lang'));
  void generateCompanyBriefing(target, lang, settings, portfolio);
  return { started: true, job: jobState(companyBriefJob(lang, targetKey(target))) };
});
