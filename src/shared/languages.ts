import { LOCALE_PACKS } from '@/locales';

// 지원 언어 목록. 문구·프롬프트를 직접 쓴 언어는 BaseLang 둘이고, 나머지는 영어를 바탕으로 동작한다.

export type Lang = string;
export type BaseLang = 'ko' | 'en';

export interface LanguageInfo {
  code: Lang;
  name: string;
  englishName: string;
  locale: string;
}

export const DEFAULT_LANG: Lang = 'en';

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', name: 'English', englishName: 'English', locale: 'en-US' },
  { code: 'ko', name: '한국어', englishName: 'Korean', locale: 'ko-KR' },
  ...LOCALE_PACKS.map(({ code, name, englishName, locale }) => ({ code, name, englishName, locale })),
];

export const LANGS: readonly Lang[] = LANGUAGES.map((l) => l.code);

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && LANGS.includes(v);

export const languageInfo = (lang: Lang): LanguageInfo => LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0]!;

/** 한국어 외에는 영어 문구·프롬프트를 바탕으로 쓴다 */
export const baseLang = (lang: Lang): BaseLang => (lang === 'ko' ? 'ko' : 'en');

/** 브리핑 파일 이름 뒤에 붙는 언어 표시 */
export const langFileSuffix = (lang: Lang): string => (lang === 'ko' ? '' : `_${lang}`);

/** 프롬프트에 붙이는 출력 언어 지시. 직접 쓴 프롬프트가 있는 언어는 그대로 둔다 */
export const withLang = (prompt: string, lang: Lang): string =>
  (lang === 'ko' || lang !== 'ko'
    ? prompt
    : `${prompt}\n\nWrite everything you output in ${languageInfo(lang).englishName}, even where the instructions above say English. Keep quoted excerpts from sources in their original language.`);
