// 매매일지(모의 계좌·거래 메모·판단 분석·사후 성과·행동 패턴·AI 자기평가)에서 서버와 화면이 함께 쓰는 타입.

export type TradeSide = 'buy' | 'sell';
/** initial = 처음 기록을 시작할 때 이미 있던 보유분, order = 주문창, edit = 편집기·에이전트로 수량을 바꾼 것 */
export type TradeSource = 'initial' | 'order' | 'edit';
export type PlanFollowed = 'yes' | 'partial' | 'no';

/** 사후 성과를 재는 기간(일) */
export const HORIZONS = [7, 30, 90] as const;
export type Horizon = (typeof HORIZONS)[number];

export const EMOTIONS = ['fomo', 'fear', 'greed', 'regret', 'overconfidence', 'impatience', 'anxiety', 'revenge', 'calm', 'conviction'] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const INFO_SOURCES = ['news', 'chart', 'community', 'acquaintance', 'ai_agent', 'report', 'own_analysis', 'other'] as const;
export type InfoSource = (typeof INFO_SOURCES)[number];

export const STRATEGIES = ['momentum', 'value', 'dip_buy', 'earnings', 'news_event', 'long_term', 'rebalance', 'stop_loss', 'take_profit', 'other'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const TIME_HORIZONS = ['intraday', 'days', 'weeks', 'months', 'years', 'unknown'] as const;
export type TimeHorizon = (typeof TIME_HORIZONS)[number];

/** 거래 직후 남긴 메모와 계획 */
export interface TradeNote {
  memo: string;
  /** 계획대로 했는지 */
  planFollowed: PlanFollowed | null;
  /** 미리 세운 계획(예: "실적 발표까지 보유, -8% 손절") */
  plan: string;
  target: number | null;
  stop: number | null;
  createdAt: number;
}

/** 메모·대화에서 뽑은 판단 구조(감정은 근거 발췌가 메모·대화에 실제로 있을 때만 "확인 가능") */
export interface DecisionData {
  rationale: string[];
  emotions: { label: Emotion; evidence: string; verified: boolean }[];
  sources: InfoSource[];
  strategy: Strategy;
  horizon: TimeHorizon;
}

export interface Decision {
  status: 'pending' | 'done' | 'error';
  data: DecisionData | null;
  /** 사용자가 감정·전략을 확인(또는 고쳐서 확인)했으면 true */
  confirmed: boolean;
  error: string | null;
  /** 분석에 함께 쓴 대화 발췌 수 */
  chatExcerpts: number;
  updatedAt: number;
}

/** 거래 이후 기간 성과. edge = 시장 대비 판단 성과(매수: 주가-지수, 매도: 지수-주가) */
export interface Outcome {
  horizon: Horizon;
  /** 기간이 다 지나 확정됐으면 true, 아니면 오늘까지의 중간값 */
  final: boolean;
  date: string;
  ret: number;
  benchSymbol: string;
  benchRet: number | null;
  edge: number | null;
}

export interface Trade {
  id: number;
  symbol: string;
  name: string;
  side: TradeSide;
  qty: number;
  price: number;
  currency: string;
  /** 체결 시 기준 통화 환율(기준 통화 종목은 1) */
  fx: number;
  date: string;
  executedAt: number;
  source: TradeSource;
  /** 매도면 FIFO 로 계산한 실현 손익(기준 통화)과 보유 일수 */
  realizedBase: number | null;
  realizedPct: number | null;
  holdDays: number | null;
  /** 체결 전 5거래일 주가 변화(%) — 추격 매수 판단용 */
  priorMove: number | null;
  note: TradeNote | null;
  decision: Decision | null;
  outcomes: Outcome[];
}

export interface Position {
  symbol: string;
  name: string;
  qty: number;
  avgPrice: number;
  currency: string;
  /** 매입금액(기준 통화, 체결일 환율) */
  costBase: number;
  last: number | null;
  valueBase: number | null;
  pnlBase: number | null;
  pnlPct: number | null;
}

/** 잔고(모의): 포트폴리오 수량을 원장(FIFO)으로 따라간 결과 */
export interface Ledger {
  positions: Position[];
  costBase: number;
  valueBase: number | null;
  unrealizedBase: number | null;
  unrealizedPct: number | null;
  realizedBase: number;
  /** 기록을 시작한 시각(이때 있던 보유분은 기초 보유) */
  since: number | null;
}

export type PatternId = 'loss_aversion' | 'impulsive' | 'quick_rebuy' | 'plan_deviation' | 'overtrading' | 'chasing';

/** 행동 패턴 하나(숫자는 거래 기록에서 코드로 계산, 말은 화면 문자열) */
export interface BehaviorPattern {
  id: PatternId;
  /** 판단할 만큼 거래가 있으면 true */
  enough: boolean;
  /** 패턴이 보이면 true */
  flagged: boolean;
  /** 해당 거래 수 / 대상 거래 수 */
  count: number;
  total: number;
  /** 패턴별 핵심 수치(예: 손실 보유 일수 ÷ 이익 보유 일수) */
  metric: number | null;
  /** 해당 거래와 나머지 거래의 30일 시장 대비 성과 평균 */
  edgeHit: number | null;
  edgeRest: number | null;
  tradeIds: number[];
}

export interface BehaviorProfile {
  trades: number;
  sells: number;
  /** 확정된 30일 성과가 있는 결정 중 시장을 이긴 비율 */
  hitRate30: number | null;
  avgEdge30: number | null;
  patterns: BehaviorPattern[];
  emotions: { label: Emotion; count: number; avgEdge30: number | null }[];
}

export type Stance = 'up' | 'down' | 'neutral';

/** 에이전트가 답에서 낸 해석(사용자 판단과 같은 기준으로 사후 평가) */
export interface AiOpinion {
  id: number;
  chatId: string | null;
  createdAt: number;
  date: string;
  symbol: string;
  stance: Stance;
  text: string;
  basePrice: number;
  outcomes: Outcome[];
}

export interface AiScore {
  opinions: number;
  /** 확정된 30일 성과 기준 적중률(상승·하락 의견만) */
  hitRate30: number | null;
  avgEdge30: number | null;
}

export interface JournalView {
  ledger: Ledger;
  trades: Trade[];
  profile: BehaviorProfile;
  ai: { opinions: AiOpinion[]; score: AiScore };
  /** 사용자 판단 점수(같은 기준) */
  user: AiScore;
  llmOnline: boolean;
}

/** 과거의 비슷한 거래(점검 질문의 근거) */
export interface SimilarTrade {
  trade: Trade;
  score: number;
  reasons: string[];
}

export interface CoachView {
  symbol: string;
  side: TradeSide;
  similar: SimilarTrade[];
  /** 점검 질문·개선 방법(마크다운, 근거 [T#] 포함) */
  markdown: string | null;
  error: string | null;
}

/** 서버에 저장하는 대화 세션 */
export interface StoredChat {
  id: string;
  title: string;
  updatedAt: number;
  msgs: unknown[];
}
