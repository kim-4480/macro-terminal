import { baseLang } from '@/shared/languages';
import { type AgentScreen, type Lang, VIEW_CODES, type ViewCode } from '@/shared/types';

// 에이전트가 아는 "지금 화면": 터미널이 질문마다 보내 주고, 에이전트가 화면을 열면 바뀐다.

const NAMES: Record<ViewCode, { ko: string; en: string }> = {
  HOME: { ko: '홈(대시보드)', en: 'Home (dashboard)' },
  ECO: { ko: '거시경제 지표', en: 'Macro indicators' },
  MKT: { ko: '글로벌 시장', en: 'Global markets' },
  GC: { ko: '미국 국채 금리 곡선', en: 'US Treasury yield curve' },
  PORT: { ko: '내 포트폴리오', en: 'My portfolio' },
  N: { ko: '업계·거시 뉴스', en: 'Industry & macro news' },
  MAP: { ko: '뉴스 지도', en: 'News map' },
  BRIEF: { ko: '브리핑', en: 'Briefings' },
  AI: { ko: 'AI 에이전트 전체 화면', en: 'Full-screen AI agent' },
  HELP: { ko: '사용법', en: 'Help' },
};

export const screenName = (v: ViewCode, lang: Lang) => `${NAMES[v][baseLang(lang)]} (${v})`;

/** 요청 본문의 screen → 검증된 값(없거나 틀리면 null) */
export function parseScreen(raw: unknown): AgentScreen | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const view = typeof o.view === 'string' && (VIEW_CODES as readonly string[]).includes(o.view) ? (o.view as ViewCode) : null;
  if (!view) return null;
  const company = typeof o.company === 'string' && o.company.trim() ? o.company.trim().slice(0, 80) : null;
  return { view, company, drawer: o.drawer === true };
}

/** 모델에 알려 줄 한 줄 */
export function describeScreen(s: AgentScreen | null, lang: Lang): string {
  if (!s) return lang === 'ko' ? '알 수 없음' : 'unknown';
  const main = s.company
    ? (lang === 'ko' ? `회사 페이지 ${s.company}` : `company page ${s.company}`)
    : screenName(s.view, lang);
  const chat = s.view === 'AI' && !s.company ? '' : s.drawer ? (lang === 'ko' ? ' · 대화는 오른쪽 옆 창' : ' · chat in the side panel') : '';
  return main + chat;
}

/** 지금 화면이 그 화면인지 */
export const isShowing = (s: AgentScreen | null, v: ViewCode) => !!s && !s.company && s.view === v;
