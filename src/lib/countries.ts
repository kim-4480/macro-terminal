'use client';

import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import ko from 'i18n-iso-countries/langs/ko.json';
import type { Lang } from '@/shared/types';

countries.registerLocale(en);
countries.registerLocale(ko);

// 짧게 부르는 이름(표준 이름이 너무 긴 경우)
const SHORT: Partial<Record<Lang, Record<string, string>>> = {
  en: { US: 'United States', GB: 'United Kingdom', KR: 'South Korea', RU: 'Russia', TW: 'Taiwan', IR: 'Iran', VN: 'Vietnam' },
  ko: { US: '미국', GB: '영국', KR: '한국', TW: '대만', HK: '홍콩' },
};

export const countryName = (iso2: string, lang: Lang): string =>
  SHORT[lang]?.[iso2] ?? countries.getName(iso2, lang, { select: 'official' }) ?? SHORT.en?.[iso2] ?? countries.getName(iso2, 'en', { select: 'official' }) ?? iso2;

/** 세계지도(world-atlas)의 국가 id 는 ISO 3166-1 숫자 코드 */
export const toNumeric = (iso2: string): string | undefined => countries.alpha2ToNumeric(iso2);
export const toAlpha2 = (numeric: string): string | undefined => countries.numericToAlpha2(numeric);
