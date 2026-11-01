'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLang, languageInfo, type Lang } from '@/shared/languages';
import { money } from './format';
import { storage } from './storage';
import { stringsFor, type Strings } from './strings';

interface LangContextValue {
  lang: Lang;
  T: Strings;
  setLang: (lang: Lang) => void;
  /** 데이터 이름 고르기: 한국어 외 화면이면 영어 이름(없으면 한국어) */
  pick: (ko: string, en?: string | null) => string;
  /** 금액을 기준 통화로 표시 */
  money: (v: number | null | undefined) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ initial, currency = 'USD', children }: { initial: Lang; currency?: string; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  // 이 브라우저에서 고른 언어가 있으면 그걸 쓴다
  useEffect(() => {
    const saved = storage.get('lang');
    if (isLang(saved)) setLangState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    storage.set('lang', next);
    setLangState(next);
  }, []);

  const value = useMemo<LangContextValue>(() => ({
    lang,
    T: stringsFor(lang),
    setLang,
    pick: (ko, en) => (lang !== 'ko' && en ? en : ko),
    money: (v) => money(v, languageInfo(lang).locale, currency),
  }), [lang, setLang, currency]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang 은 LangProvider 안에서만 쓸 수 있습니다');
  return ctx;
}
