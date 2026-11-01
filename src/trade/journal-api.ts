'use client';

import { useSWRConfig } from 'swr';
import { fetchJson, useApi } from '@/lib/api';
import { useLang } from '@/lib/i18n';
import type { JournalView } from '@/shared/journal';
import { tradeStringsFor } from './strings';

export const JOURNAL_URL = '/api/journal';

/** 매매 앱 문구 */
export function useTR() {
  const { lang } = useLang();
  return tradeStringsFor(lang);
}

/** 매매일지 데이터. 판단 분석이 진행 중이면 자주 새로 받는다 */
export function useJournal() {
  return useApi<JournalView>(JOURNAL_URL, {
    refreshInterval: (data) => (data?.trades.some((t) => t.decision?.status === 'pending') ? 3000 : 30_000),
    revalidateOnFocus: true,
  });
}

/** 일지 작업 보내기 → 일지·포트폴리오 새로고침 */
export function useJournalPost() {
  const { mutate } = useSWRConfig();
  return async <T = { ok: boolean }>(body: Record<string, unknown>): Promise<T> => {
    const out = await fetchJson<T>(JOURNAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Macro-Terminal': '1' },
      body: JSON.stringify(body),
    });
    if (body.action !== 'coach') void mutate((key) => typeof key === 'string' && (key === JOURNAL_URL || key.startsWith('/api/portfolio')));
    return out;
  };
}
