'use client';

import { useLang } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { LANGUAGES, DEFAULT_LANG, isLang } from '@/shared/languages';

const KOREAN = LANGUAGES.find((l) => l.code === 'ko')!;
const OTHERS = LANGUAGES.filter((l) => l.code !== 'ko');

/**
 * 언어 고르기: 맨 위에 한국어 토글, 그 아래에 그 밖의 언어 드롭다운.
 * 토글을 끄면 마지막으로 쓴 다른 언어로 돌아간다. 드롭다운 목록은 languages.ts 에 등록된 언어에서 나온다.
 */
export function LangSwitch() {
  const { lang, setLang } = useLang();
  const korean = lang === 'ko';
  const pick = (code: string) => {
    storage.set('langOther', code);
    setLang(code);
  };
  const lastOther = () => {
    const saved = storage.get('langOther');
    return isLang(saved) ? saved : DEFAULT_LANG;
  };
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      <button type="button" className={korean ? 'active' : ''} aria-pressed={korean} onClick={() => (korean ? setLang(lastOther()) : setLang('ko'))}>
        {KOREAN.name}
      </button>
      <select aria-label="Other languages" className={korean ? '' : 'active'} value={korean ? '' : lang} onChange={(e) => pick(e.target.value)}>
        {korean ? <option value="" hidden>Language</option> : null}
        {OTHERS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </div>
  );
}
