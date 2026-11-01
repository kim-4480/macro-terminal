'use client';

import { createContext, useContext } from 'react';
import type { ChartTarget, NewsItem, ViewCode } from '@/shared/types';

/** 패널·검색창이 화면을 바꿀 때 쓰는 동작들(Terminal 이 제공) */
export interface TerminalActions {
  openChart: (target: ChartTarget) => void;
  setView: (view: ViewCode) => void;
  selectTopic: (topicId: string) => void;
  /** AI 질문 창 열기(질문을 주면 바로 보낸다) */
  openChat: (question?: string) => void;
  /** 회사 페이지 열기(hint: 검색에서 본 이름) */
  openCompany: (symbol: string, hint?: string) => void;
  /** 비상장 기업 페이지(뉴스·브리핑만) */
  openEntity: (nameEn: string, hint?: string) => void;
  /** 뉴스를 터미널 안에서 열기(본문 + 원문 링크) */
  openArticle: (item: NewsItem) => void;
  /** 포트폴리오 편집기(prefill: 추가할 종목) */
  openPortfolioEditor: (prefill?: { symbol: string; name: string; nameEn: string }) => void;
}

export const ActionsContext = createContext<TerminalActions | null>(null);

export function useActions(): TerminalActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions 는 Terminal 안에서만 쓸 수 있습니다');
  return ctx;
}
