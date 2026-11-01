import type { LocalePack } from './types';

// 기본 제공은 영어·한국어(lib/strings.ts, trade/strings.ts)뿐이다. 다른 언어는 여기에 묶음을 더한다.
// npm run lang:add -- <코드> <이름> <영어 이름> <로케일> 이 파일 생성과 등록을 대신한다.
// lang:add 가 아래 두 표시를 찾아 줄을 넣으므로 지우지 않는다.
// lang:add imports

export const LOCALE_PACKS: LocalePack[] = [
  // lang:add packs
];
