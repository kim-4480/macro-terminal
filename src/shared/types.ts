// 서버(API 라우트)와 화면(React)이 함께 쓰는 응답 타입.

export { LANGS, type BaseLang, type Lang } from './languages';
import type { BaseLang, Lang } from './languages';

/** [YYYY-MM-DD, 값] — 날짜 오름차순 */
export type Point = [date: string, value: number];

/** pct = 변화율(%), diff = 차이(금리 등은 %p) */
export type ChangeMode = 'pct' | 'diff';

export interface Changes {
  d1: number | null;
  m1: number | null;
  ytd: number | null;
  y1: number | null;
}

export interface Stats {
  date: string;
  value: number;
  chg: Changes;
}

export interface MacroRow extends Partial<Stats> {
  id: string;
  group: string;
  groupEn?: string;
  label: string;
  labelEn?: string;
  unit: string;
  transform: 'yoy' | null;
  mode: ChangeMode;
  spark?: Point[];
  error?: string;
  keyRequired?: boolean;
}

export interface MarketRow extends Partial<Stats> {
  symbol: string;
  label: string;
  labelEn?: string;
  currency?: string | null;
  spark?: Point[];
  error?: string;
}

/** 상단 주요 지표 띠 한 칸 */
export interface StripItem extends Partial<Stats> {
  id: string;
  label: string;
  labelEn?: string;
  unit: string;
  mode: ChangeMode;
  error?: string;
}

export interface CurveLine {
  key: 'now' | 'm1' | 'y1';
  date: string;
  values: (number | null)[];
}

export interface YieldCurve {
  date: string;
  tenors: string[];
  lines: CurveLine[];
}

export interface HoldingRow extends Partial<Stats> {
  symbol: string;
  name: string;
  nameEn: string;
  industry: string;
  industryLabel: string;
  industryLabelEn: string;
  qty?: number | null;
  currency?: string | null;
  valueBase?: number | null;
  weight?: number;
  spark?: Point[];
  error?: string;
}

export interface IndustryRow {
  id: string;
  label: string;
  labelEn: string;
  weight: number;
  chg: Changes;
  benchmark: ({ symbol: string; name: string } & Stats) | null;
}

export interface PortfolioView {
  example: boolean;
  baseCurrency: string;
  totalBase: number | null;
  dayPnlBase: number | null;
  chg: Changes;
  fx: Record<string, number | null>;
  rows: HoldingRow[];
  industries: IndustryRow[];
}

export type JobStatus = 'running' | 'done' | 'error' | 'waiting-network';

export interface JobState {
  state: JobStatus;
  error: string | null;
  startedAt: number;
  finishedAt?: number;
}

export interface TopicInfo {
  id: string;
  label: string;
  labelEn: string;
  kind: 'general' | 'industry';
  holdings: string[];
  holdingsEn: string[];
}

export interface NewsItem {
  id: string;
  title: string;
  lang: Lang;
  source: string;
  link: string;
  published: number | null;
  /** 화면 언어로 번역된 제목(같은 언어면 원문, 번역 전이면 null) */
  titleT: string | null;
}

/** 기사 본문을 못 읽은 이유 */
export type ArticleFailure = 'google-blocked' | 'google' | 'site-blocked' | 'no-body' | 'network';

/** 기사 본문 번역: 원문 문단과 같은 순서, 아직 번역 안 된 문단은 null */
export interface ArticleTranslation {
  paragraphs: (string | null)[];
  complete: boolean;
  llmOnline: boolean;
  error: string | null;
  /** 번역하지 못해 원문으로 둔 조각 수 */
  skipped: number;
}

/** 터미널 안에서 보는 기사(본문은 원문 그대로) */
export interface ArticleView {
  /** 목록의 링크(구글 뉴스 등) */
  link: string;
  /** 실제 기사 주소 */
  url: string;
  title: string;
  text: string;
  /** 본문을 다 못 읽고 요약만 얻었으면 true */
  partial: boolean;
  /** 본문을 못 읽은 이유(원문 링크는 그대로 보여 준다) */
  error: string | null;
  reason: ArticleFailure | null;
}

export interface NewsResponse {
  topic: TopicInfo;
  lang: Lang;
  items: NewsItem[];
  digest: string | null;
  pending: boolean;
  /** 자동 호출이 꺼져 있어 사용자가 누르면 번역·요약을 시작한다 */
  manualEnrich: boolean;
  llmOnline: boolean;
  job: JobState | null;
}

/** 지도용 뉴스: 위치(국가 ISO 3166-1 alpha-2, 알려진 도시)와 소속 주제 */
export interface MapNewsItem extends NewsItem {
  topicId: string;
  country: string | null;
  city: string | null;
  /** llm = 모델 태깅, keyword = 모델 없을 때 키워드 규칙 */
  geoSource: 'llm' | 'keyword' | null;
}

export interface NewsMapResponse {
  lang: Lang;
  items: MapNewsItem[];
  topics: TopicInfo[];
  pending: boolean;
  llmOnline: boolean;
  job: JobState | null;
}

export type BriefingKind = 'daily' | 'weekly' | 'monthly';
export const BRIEFING_KINDS: readonly BriefingKind[] = ['daily', 'weekly', 'monthly'];

export interface BriefingResponse {
  kind: BriefingKind;
  lang: Lang;
  files: string[];
  file: string | null;
  markdown: string | null;
  job: JobState | null;
}

export type SearchKind = 'fn' | 'macro' | 'market' | 'holding' | 'stock' | 'index' | 'topic' | 'entity';

export interface SearchResult {
  key: string;
  kind: SearchKind;
  title: string;
  titleEn?: string;
  sub?: string;
  /** 차트용 시계열 id (fred:…, ecos:…, yahoo:…) */
  id?: string;
  symbol?: string;
  unit?: string;
  topic?: string;
  /** 화면 코드(kind === 'fn') */
  code?: string;
  /** 비상장 기업의 영어 이름(kind === 'entity') */
  entity?: string;
  /** 한국어 이름을 근거(KRX·위키데이터·기사)로 확인하지 못해 영어 이름을 보여 줌 */
  koUnverified?: boolean;
  score: number;
}

export interface SearchResponse {
  query: string;
  translated: string | null;
  krxError: string | null;
  results: SearchResult[];
  /** 빠른 단계 응답: 깊은 검색(모델·Yahoo)을 이어서 하면 더 나올 수 있다 */
  deepAvailable: boolean;
}

export interface CompanyProfile {
  symbol: string;
  longName?: string | null;
  shortName?: string | null;
  sector?: string | null;
  industry?: string | null;
  country?: string | null;
  currency?: string | null;
  marketCap?: number | null;
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  /** 퍼센트 단위(yfinance 1.x 기준, 예: 0.47 = 0.47%) */
  dividendYield?: number | null;
  fiftyTwoWeekLow?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fullTimeEmployees?: number | null;
  website?: string | null;
  summary: string | null;
  summaryPending: boolean;
}

/** 회사 페이지(비상장 기업이면 symbol 이 null 이고 시세·차트가 없다) */
export interface CompanyView {
  symbol: string | null;
  listed: boolean;
  nameKo: string;
  nameEn: string;
  currency: string | null;
  exchange: string | null;
  quote: Stats | null;
  quoteError?: string;
  /** 52주 고가·저가(시세에서 계산) */
  range52w: { low: number; high: number } | null;
  /** 내 포트폴리오에 있으면 */
  holding: { qty: number | null; industry: string; industryLabel: string; industryLabelEn: string } | null;
  news: NewsItem[];
  digest: string | null;
  newsPending: boolean;
  newsError?: string;
  llmOnline: boolean;
  newsJob: JobState | null;
  briefing: { markdown: string; generatedAt: number } | null;
  briefingJob: JobState | null;
}

/** 포트폴리오 편집기에서 주고받는 형식(config/portfolio.json 과 같음) */
export interface PortfolioConfig {
  example: boolean;
  note?: string;
  industries: { id: string; label: string; labelEn?: string; benchmark?: string; en: string[]; ko: string[] }[];
  holdings: { symbol: string; name?: string; nameEn?: string; industry: string; qty?: number }[];
}

export interface StatusResponse {
  llm: { online: boolean; reason: 'ok' | 'unreachable' | 'auth' | 'error'; models?: string[]; baseUrl: string; model: string; local: boolean };
  setupDone: boolean;
  internet: boolean;
  jobs: Record<string, JobState>;
  example: boolean;
  ecosKey: boolean;
  yfinance: boolean;
  language: Lang;
  configError: string | null;
  now: number;
}

export type ViewCode = 'HOME' | 'ECO' | 'MKT' | 'GC' | 'PORT' | 'N' | 'MAP' | 'BRIEF' | 'AI' | 'HELP';
export const VIEW_CODES: readonly ViewCode[] = ['HOME', 'ECO', 'MKT', 'GC', 'PORT', 'N', 'MAP', 'BRIEF', 'AI', 'HELP'];
/** 상단 화면 바에 보이는 것(HELP는 명령창에서 HELP로 연다) */
export const NAV_CODES: readonly ViewCode[] = ['HOME', 'ECO', 'MKT', 'GC', 'PORT', 'N', 'MAP', 'BRIEF', 'AI'];

/** 상세 차트(GP) 대상 */
export interface ChartTarget {
  id: string;
  title: string;
  unit?: string;
}

// ---- AI 질문(챗봇): 근거와 진행 상황 ----

/** 답변의 근거 하나(S0 = 터미널 데이터, S1… = 도구로 가져온 기사·시세) */
export interface ChatSource {
  id: string;
  kind: 'terminal' | 'article' | 'quote' | 'company' | 'action' | 'journal';
  title: string;
  publisher?: string;
  url?: string;
  published?: number | null;
  /** 본문을 못 찾고 요약만 읽었으면 true */
  partial?: boolean;
  /** 검색 결과에 있었지만 본문을 읽지 않은 기사(N#) */
  unread?: boolean;
}

/** 답변 속 인용문이 근거 원문에 실제로 있는지 */
export interface QuoteCheck {
  /** quote = 따옴표 안 발췌, number = 요약 문장 속 숫자 */
  kind: 'quote' | 'number';
  sourceId: string;
  quote: string;
  ok: boolean;
}

/** /api/chat 응답 스트림(줄마다 JSON 하나) */
/** 에이전트가 실행하려는 작업(포트폴리오를 바꾸는 작업은 사용자가 승인해야 실행된다) */
export interface AgentAction {
  id: string;
  kind: 'add_holding' | 'update_holding' | 'remove_holding' | 'add_industry' | 'add_indicator' | 'remove_indicator';
  /** 한 줄 요약(예: "TSMC (TSM) 1주를 반도체 업계에 추가") */
  title: string;
  /** 바뀌는 내용(항목·값) */
  detail: { label: string; value: string }[];
  /** 승인 전에 고칠 수 있는 값 */
  qty?: number | null;
  industry?: string | null;
  industries?: { id: string; label: string }[];
}

/** 승인 카드의 결과 */
export interface AgentDecision {
  id: string;
  approved: boolean;
  qty?: number | null;
  industry?: string | null;
}

/** 에이전트가 화면에서 여는 것 */
export type AgentUi =
  | { kind: 'company'; symbol: string; name?: string }
  | { kind: 'view'; code: ViewCode };

/** 사용자가 지금 보고 있는 화면(질문마다 터미널이 보내 준다) */
export interface AgentScreen {
  /** 화면 코드(AI = 전체 화면 에이전트) */
  view: ViewCode;
  /** 회사 페이지가 열려 있으면 티커(비상장이면 영어 이름) */
  company: string | null;
  /** 오른쪽 옆 창으로 대화 중이면 true */
  drawer: boolean;
}

/** 답 하나를 만들며 실제로 부른 도구(다음 질문 때 대화 기록으로 다시 넘긴다) */
export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  /** 결과 한 줄(예: "화면 열기: PORT") */
  summary: string;
}

export type ChatEvent =
  | { t: 'status'; text: string }
  | { t: 'confirm'; action: AgentAction }
  | { t: 'decided'; id: string; approved: boolean }
  | { t: 'ui'; ui: AgentUi }
  | { t: 'changed'; what: 'portfolio' | 'macro' }
  /** 에이전트 작업으로 생긴 매매(거래 메모를 받는다) */
  | { t: 'trades'; ids: number[] }
  | { t: 'source'; source: ChatSource }
  | { t: 'answer'; text: string }
  | { t: 'checks'; checks: QuoteCheck[]; uncited: number }
  | { t: 'trace'; calls: ToolTrace[] }
  | { t: 'error'; text: string }
  | { t: 'done' };
