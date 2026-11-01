import { BRIEFING_KINDS, type BriefingKind, type BriefingResponse } from '@/shared/types';
import { pickLang, route } from '@/server/api';
import { briefingJobName, generateBriefing, listBriefings, readBriefing } from '@/server/briefing';
import { jobState } from '@/server/jobs';
import { generatePeriodic, listPeriodic, periodicJobName, readPeriodic } from '@/server/periodic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pickKind = (v: string | null): BriefingKind => (BRIEFING_KINDS.includes(v as BriefingKind) ? (v as BriefingKind) : 'daily');

/** ?kind=daily|weekly|monthly &lang= &file= */
export const GET = route(({ url }): BriefingResponse => {
  const kind = pickKind(url.searchParams.get('kind'));
  const lang = pickLang(url.searchParams.get('lang'));
  const files = kind === 'daily' ? listBriefings(lang) : listPeriodic(kind, lang);
  const want = url.searchParams.get('file');
  const file = want && files.includes(want) ? want : files[0] ?? null;
  const read = (f: string) => (kind === 'daily' ? readBriefing(f) : readPeriodic(kind, f));
  const job = jobState(kind === 'daily' ? briefingJobName(lang) : periodicJobName(kind, lang));
  return { kind, lang, files, file, markdown: file ? read(file) : null, job };
});

export const POST = route(({ settings, portfolio, url }) => {
  const kind = pickKind(url.searchParams.get('kind'));
  const lang = pickLang(url.searchParams.get('lang'));
  if (kind === 'daily') void generateBriefing(settings, portfolio, lang);
  else void generatePeriodic(kind, settings, portfolio, lang);
  return { started: true, job: jobState(kind === 'daily' ? briefingJobName(lang) : periodicJobName(kind, lang)) };
});
