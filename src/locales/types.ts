import type { Strings } from '@/lib/strings';
import type { JournalStrings } from '@/trade/strings';

type DeepPartial<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** 언어 하나를 더하는 묶음. 번역하지 않은 문구는 영어로 나온다. 자세한 방법: docs/adding-a-language.md */
export interface LocalePack {
  /** BCP 47 언어 코드(예: ja, de, pt-BR) */
  code: string;
  /** 드롭다운에 보일 그 언어 이름(예: 日本語) */
  name: string;
  /** 모델에게 "이 언어로 쓰라"고 할 때 쓰는 영어 이름(예: Japanese) */
  englishName: string;
  /** 날짜·숫자 형식(예: ja-JP) */
  locale: string;
  /** 터미널 화면 문구 */
  strings?: DeepPartial<Strings>;
  /** 모의 매매 앱 문구 */
  trade?: DeepPartial<JournalStrings>;
}
