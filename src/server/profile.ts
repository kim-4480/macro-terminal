import { languageInfo } from '@/shared/languages';
import type { CompanyProfile, Lang } from '@/shared/types';
import { cached, peek, put } from './cache';
import type { Settings } from './config';
import { chat, llmStatus } from './llm';
import { yfProfile } from './sources/yfinance';
import { hash } from './util';

const g = globalThis as typeof globalThis & { __profileJobs?: Set<string> };
const translating = (g.__profileJobs ??= new Set());

/** yfinance 기업 개요. 영어 외 화면이면 사업 설명을 모델로 번역(백그라운드). */
export async function companyProfile(symbol: string, lang: Lang, settings: Settings): Promise<CompanyProfile> {
  const { longBusinessSummary, ...p } = await cached(`yfprofile:${symbol}`, 24 * 3600e3, () => yfProfile(symbol));
  let summary = longBusinessSummary ?? null;
  let summaryPending = false;
  if (lang !== 'en' && longBusinessSummary) {
    const key = `proftr:${lang}:${hash(longBusinessSummary)}`;
    const hit = peek<string>(key);
    if (hit) summary = hit.value;
    else if (settings.automation.background && (await llmStatus(settings.llm)).online) {
      summaryPending = true;
      if (!translating.has(key)) {
        translating.add(key);
        chat(settings.llm, [
          { role: 'system', content: lang === 'ko' ? '기업 소개문을 자연스러운 한국어로 번역한다. 회사명·제품명은 한국 언론 표기를 따른다. 번역문만 출력한다.' : `Translate this company description into natural ${languageInfo(lang).englishName}. Output only the translation.` },
          { role: 'user', content: longBusinessSummary },
        ], { maxTokens: 1200, temperature: 0.1 })
          .then((t) => put(key, t))
          .catch(() => undefined)
          .finally(() => translating.delete(key));
      }
    }
  }
  return { symbol, ...p, summary, summaryPending };
}
