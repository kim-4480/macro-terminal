'use client';

import useSWR, { type SWRConfiguration } from 'swr';

export class ApiError extends Error {}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText);
  return body;
}

const REFRESH_MS = 5 * 60e3;

/** 화면 데이터: 5분마다 새로고침, 오류 시 마지막 데이터 유지 */
export function useApi<T>(url: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(url, fetchJson, { refreshInterval: REFRESH_MS, revalidateOnFocus: false, keepPreviousData: true, ...config });
}

export const qs = (params: Record<string, string | null | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) p.set(k, v);
  return p.toString();
};
