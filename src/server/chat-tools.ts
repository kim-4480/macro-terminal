import { VIEW_CODES, type AgentScreen, type AgentUi, type ChatSource, type BaseLang, type Lang, type ViewCode } from '@/shared/types';
import { describeScreen, isShowing } from './agent-screen';
import { cached } from './cache';
import { computeProfile } from './journal/behavior';
import { similarTrades, tradeSourceText } from './journal/coach';
import { journalTrades } from './journal/view';
import { SYMBOL_RE } from './company';
import type { Portfolio, Settings } from './config';
import type { ToolCall, ToolSpec } from './llm';
import { quote } from './market-data';
import { search } from './search';
import { INDICATOR_ID_HELP, probeIndicator } from './indicators';
import { readArticle } from './sources/article';
import { readWebPage, webSearch } from './sources/web';
import { bingNews, type NewsHit } from './sources/bing-news';
import { yfProfile } from './sources/yfinance';
import { changeStats, errorMessage, shiftDate, sinceDate, today } from './util';

// 챗봇 도구: 모르는 것은 검색하고 기사 본문을 읽어 근거(S1, S2…)로 삼는다.
// 근거가 되는 결과(시세·회사 개요·기사)는 모두 번호를 붙여 등록하고, 답변의 인용문은 이 본문과 대조한다.

export const TOOLS: ToolSpec[] = [
  {
    name: 'search_news',
    description: 'Search recent news articles (last ~2 weeks). Returns refs like N1, N2 with titles. You must call read_article on a ref before using it as evidence. To list an unread article, write its title followed by its ref, like [N3].',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'search words (company, topic)' }, lang: { type: 'string', enum: ['ko', 'en'], description: 'ko for Korean press, en for global press' } }, required: ['query'] },
  },
  {
    name: 'read_article',
    description: 'Read the body text of a news result (ref from search_news). Returns a source id (S#) and the text you may quote from.',
    parameters: { type: 'object', properties: { ref: { type: 'string', description: 'e.g. N2' } }, required: ['ref'] },
  },
  {
    name: 'get_quote',
    description: 'Latest price and 1D/1M/YTD/1Y changes for a Yahoo Finance ticker (stock, index ^GSPC, FX KRW=X, future GC=F, crypto BTC-USD). Returns a source id.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'get_company',
    description: 'Company profile for a listed ticker: sector, industry, country, market cap, P/E, business description. Returns a source id.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'get_history',
    description: 'Daily closing prices for the last N days (1-60, default 7) for a ticker, with the change over the period. Use for "recent trend" questions. Returns a source id.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, days: { type: 'number' } }, required: ['symbol'] },
  },
  {
    name: 'open_company',
    description: 'Open the company page for a ticker on the user\'s screen.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'open_screen',
    description: 'Switch the user\'s screen: HOME, ECO (macro), MKT (markets), GC (yield curve), PORT (portfolio), N (news), MAP (news map), BRIEF (briefings).',
    parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'get_journal',
    description: 'The user\'s own trading journal from the paper ledger: recent trades with their notes, plan adherence, extracted rationale/emotions/strategy, realized P&L and 7/30/90-day results vs the market. Optional symbol filter. Returns a source id. Use for questions about the user\'s past trades or why a loss happened.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'number' } } },
  },
  {
    name: 'get_behavior_profile',
    description: 'The user\'s behavior patterns computed from their trades (loss aversion, impulsive trades, quick rebuys, plan deviation, overtrading, chasing) with edge vs market for affected vs other trades. Returns a source id.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'find_similar_trades',
    description: 'Past trades of the user similar to a given ticker and side (same ticker/industry, strategy, emotions, prior price move), with what happened after. Use to connect a current decision to past ones. Returns a source id.',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] } }, required: ['symbol'] },
  },
  {
    name: 'web_search',
    description: 'Search the web. Returns titles, URLs and snippets. Use to find where a statistic is published, such as a FRED series page, a statistics office or a downloadable CSV.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'read_web_page',
    description: 'Read a public web page or data file by URL: its text (or the first lines of a data file) and links that look like data. Returns a source id.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'list_indicators',
    description: 'The macro indicators now on the user\'s screen: id, name and group of each. Use to find the id for remove_indicator or to reuse a group.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'test_indicator',
    description: `Fetch a data series and report what it really contains: title if known, date range, latest values, observations per year. Always test a series before add_indicator, and check that it is the statistic the user asked for and still updated. ${INDICATOR_ID_HELP} transform "yoy" converts an index level to a year-over-year change. Returns a source id.`,
    parameters: { type: 'object', properties: { id: { type: 'string' }, transform: { type: 'string', enum: ['yoy'] } }, required: ['id'] },
  },
  {
    name: 'search_symbols',
    description: 'Find tickers for a company or asset name (Korean or English). Use before get_quote/get_company when you do not know the ticker.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

const ARTICLE_CHARS_FOR_MODEL = 3000;
const MAX_ARTICLES = 3;
const MAX_READ_ATTEMPTS = 6;
const MAX_PAGES = 6;

export interface RegisteredSource {
  meta: ChatSource;
  /** 모델에 보여 준 본문 — 인용문은 여기와 대조한다 */
  text: string;
}

/** 한 번의 질문(턴) 동안의 근거·검색 결과 */
export class ToolSession {
  readonly sources = new Map<string, RegisteredSource>();
  /** 이번 답에서 시세·회사를 살펴본 종목(AI 의견 기록용) */
  readonly symbols = new Set<string>();
  private readonly news = new Map<string, NewsHit>();
  private articlesRead = 0;
  private readAttempts = 0;
  /** 한도를 넘겨 기사를 또 읽으려 했는가 */
  readLimitHit = false;
  private pagesRead = 0;

  constructor(
    private readonly settings: Settings,
    private readonly portfolio: Portfolio,
    private readonly lang: Lang,
    /** 사용자의 지금 화면(에이전트가 화면을 열면 바뀐다) */
    public screen: AgentScreen | null = null,
  ) {}

  register(meta: Omit<ChatSource, 'id'>, text: string, id?: string): ChatSource {
    const sid = id ?? `S${this.sources.size}`;
    const full = { ...meta, id: sid };
    this.sources.set(sid, { meta: full, text });
    return full;
  }

  /** 더 읽을 수 있는가. 언론사가 막아 실패한 기사는 한도에 넣지 않되, 실패가 이어져도 끝없이 시도하지는 않는다 */
  canReadMore(): boolean {
    return this.articlesRead < MAX_ARTICLES && this.readAttempts < MAX_READ_ATTEMPTS;
  }

  /** 검색 결과 제목(N#) — 숫자 대조에 쓴다 */
  newsTitles(): [string, string][] {
    return [...this.news].map(([ref, hit]) => [ref, hit.title]);
  }

  /** 답에 나온 검색 결과 번호(N#) → 화면에서 링크로 바꿀 기사 정보. 모델에게 주소를 쓰게 하지 않는다(작은 모델이 주소를 틀린다) */
  citedNews(answer: string): ChatSource[] {
    const refs = new Set([...answer.matchAll(/\[(N\d+)\]/g)].map((m) => m[1]!));
    const readUrls = new Set([...this.sources.values()].map((s) => s.meta.url));
    return [...refs].flatMap((ref) => {
      const hit = this.news.get(ref);
      return hit ? [{ id: ref, kind: 'article' as const, title: hit.title, publisher: hit.publisher, url: hit.url, published: hit.published, unread: !readUrls.has(hit.url) }] : [];
    });
  }

  /** 도구 실행. 결과는 모델에 그대로 넘길 객체, newSource 는 화면에 알릴 새 근거 */
  async run(call: ToolCall): Promise<{ result: unknown; status: string; newSource?: ChatSource; ui?: AgentUi }> {
    const str = (k: string) => (typeof call.args[k] === 'string' ? (call.args[k] as string).trim() : '');
    if (['get_quote', 'get_company', 'get_history', 'open_company'].includes(call.name) && SYMBOL_RE.test(str('symbol'))) this.symbols.add(str('symbol').toUpperCase());
    try {
      switch (call.name) {
        case 'search_news': return await this.searchNews(str('query'), str('lang'));
        case 'read_article': return await this.readArticle(str('ref'));
        case 'get_quote': return await this.getQuote(str('symbol'));
        case 'get_company': return await this.getCompany(str('symbol'));
        case 'search_symbols': return await this.searchSymbols(str('query'));
        case 'web_search': return await this.webSearch(str('query'));
        case 'read_web_page': return await this.readWebPage(str('url'));
        case 'list_indicators': return {
          result: { indicators: this.settings.macro.map((m) => ({ id: m.id, label: m.label, labelEn: m.labelEn, group: m.group })) },
          status: this.lang === 'ko' ? '지표 목록 확인' : 'Listing indicators',
        };
        case 'test_indicator': return await this.testIndicator(str('id'), call.args.transform === 'yoy' ? 'yoy' : undefined);
        case 'get_history': return await this.getHistory(str('symbol'), typeof call.args.days === 'number' ? call.args.days : Number(call.args.days) || 7);
        case 'open_company': return this.openCompany(str('symbol'));
        case 'open_screen': return this.openScreen(str('code'));
        case 'get_journal': return await this.getJournal(str('symbol').toUpperCase(), Number(call.args.limit) || 12);
        case 'get_behavior_profile': return await this.getBehavior();
        case 'find_similar_trades': return await this.findSimilar(str('symbol').toUpperCase(), call.args.side === 'sell' ? 'sell' : 'buy');
        default: return { result: { error: `unknown tool ${call.name}` }, status: call.name };
      }
    } catch (err) {
      return { result: { error: errorMessage(err) }, status: `${call.name}: ${errorMessage(err)}` };
    }
  }

  private async searchNews(query: string, lang: string) {
    if (!query) throw new Error('query 가 필요합니다');
    const l: BaseLang = lang === 'en' || lang === 'ko' ? lang : (/[가-힣]/.test(query) ? 'ko' : 'en');
    const hits = await cached(`bing:${l}:${query.toLowerCase()}`, 20 * 60e3, () => bingNews(query, l, 8));
    const list = hits.map((h) => {
      const ref = `N${this.news.size + 1}`;
      this.news.set(ref, h);
      return { ref, title: h.title, publisher: h.publisher, date: h.published ? new Date(h.published).toISOString().slice(0, 10) : null, snippet: h.snippet };
    });
    return { result: { query, results: list }, status: `${this.lang === 'ko' ? '뉴스 검색' : 'Searching news'}: ${query}` };
  }

  private async webSearch(query: string) {
    if (!query) throw new Error('query 가 필요합니다');
    const results = await cached(`web:${query.toLowerCase()}`, 60 * 60e3, () => webSearch(query));
    return { result: { query, results }, status: `${this.lang === 'ko' ? '웹 검색' : 'Searching the web'}: ${query}` };
  }

  private async readWebPage(url: string) {
    if (this.pagesRead >= MAX_PAGES) throw new Error(`페이지는 한 번에 ${MAX_PAGES}개까지 읽을 수 있습니다`);
    this.pagesRead++;
    const page = await readWebPage(url);
    const src = this.register({ kind: 'article', title: page.title || url, publisher: new URL(page.url).hostname, url: page.url, published: null, partial: false }, page.text);
    return {
      result: { source: src.id, url: page.url, title: page.title, text: page.text, dataLinks: page.dataLinks },
      status: `${this.lang === 'ko' ? '페이지 읽기' : 'Reading'}: ${new URL(page.url).hostname}`,
      newSource: src,
    };
  }

  private async testIndicator(id: string, transform?: 'yoy') {
    const probe = await probeIndicator(id, this.settings, transform);
    const src = this.register({ kind: 'terminal', title: probe.title ?? id, publisher: id.split(':')[0]!.toUpperCase(), published: Date.now() }, JSON.stringify(probe));
    return { result: { source: src.id, ...probe, next: 'If the user asked to add this and it is the right statistic, call add_indicator now with this id. Otherwise keep looking.' }, status: `${this.lang === 'ko' ? '지표 확인' : 'Testing series'}: ${id.slice(0, 60)}`, newSource: src };
  }

  private async readArticle(ref: string) {
    const hit = this.news.get(ref.toUpperCase());
    if (!hit) throw new Error(`${ref}: search_news 결과의 ref 가 아닙니다`);
    if (!this.canReadMore()) {
      this.readLimitHit = true;
      throw new Error(`기사는 한 번에 ${MAX_ARTICLES}개까지 읽을 수 있습니다`);
    }
    this.readAttempts++;
    const a = await readArticle(hit.url);
    this.articlesRead++;
    const text = a.text.slice(0, ARTICLE_CHARS_FOR_MODEL);
    const src = this.register({ kind: 'article', title: a.title || hit.title, publisher: hit.publisher, url: hit.url, published: hit.published, partial: a.partial }, text);
    return {
      result: { source: src.id, title: src.title, publisher: hit.publisher, date: hit.published ? new Date(hit.published).toISOString().slice(0, 10) : null, partial: a.partial, text },
      status: `${this.lang === 'ko' ? '기사 읽기' : 'Reading'}: ${hit.publisher} — ${hit.title.slice(0, 50)}`,
      newSource: src,
    };
  }

  private async getQuote(symbol: string) {
    const sym = symbol.toUpperCase();
    if (!SYMBOL_RE.test(sym)) throw new Error('잘못된 티커');
    const q = await quote(sym);
    const s = changeStats(q.points, 'pct');
    if (!s) throw new Error('시세 없음');
    const year = sinceDate(q.points, shiftDate(today(), { years: -1 })).map((p) => p[1]);
    const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
    const text = `${q.name} (${sym}) last price ${s.value.toFixed(2)} ${q.currency ?? ''} as of ${s.date}. 1-day change ${pct(s.chg.d1)}, 1-month change ${pct(s.chg.m1)}, year-to-date change ${pct(s.chg.ytd)}, 1-year change ${pct(s.chg.y1)}. 52-week range ${Math.min(...year).toFixed(2)} to ${Math.max(...year).toFixed(2)}.`;
    const src = this.register({ kind: 'quote', title: `${q.name} (${sym})`, publisher: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`, published: Date.now() }, text);
    return { result: { source: src.id, text }, status: `${this.lang === 'ko' ? '시세 확인' : 'Quote'}: ${sym}`, newSource: src };
  }

  private async getCompany(symbol: string) {
    const sym = symbol.toUpperCase();
    if (!SYMBOL_RE.test(sym)) throw new Error('잘못된 티커');
    const p = await cached(`yfprofile:${sym}`, 24 * 3600e3, () => yfProfile(sym));
    const text = [
      `${p.longName ?? p.shortName ?? sym} (${sym}).`,
      p.sector ? `Sector: ${p.sector}; industry: ${p.industry ?? 'n/a'}.` : '',
      p.country ? `Country: ${p.country}.` : '',
      p.marketCap ? `Market capitalization: ${p.marketCap} ${p.currency ?? ''}.` : '',
      p.trailingPE != null ? `Trailing P/E: ${p.trailingPE.toFixed(2)}.` : '',
      p.forwardPE != null ? `Forward P/E: ${p.forwardPE.toFixed(2)}.` : '',
      p.longBusinessSummary ?? '',
    ].filter(Boolean).join(' ').slice(0, ARTICLE_CHARS_FOR_MODEL);
    const src = this.register({ kind: 'company', title: `${p.longName ?? sym} — company profile`, publisher: 'Yahoo Finance (yfinance)', url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/profile`, published: null }, text);
    return { result: { source: src.id, text }, status: `${this.lang === 'ko' ? '회사 정보' : 'Company'}: ${sym}`, newSource: src };
  }

  private async getHistory(symbol: string, daysRaw: number) {
    const sym = symbol.toUpperCase();
    if (!SYMBOL_RE.test(sym)) throw new Error('잘못된 티커');
    const days = Math.min(60, Math.max(1, Math.round(daysRaw)));
    const q = await quote(sym);
    // 기준일(days 일 전) 직전 종가부터 → 기간 변화 계산
    const from = shiftDate(today(), { days: -days });
    const idx = q.points.findIndex((p) => p[0] >= from);
    const pts = idx < 0 ? q.points.slice(-1) : q.points.slice(Math.max(0, idx - 1));
    if (pts.length < 2) throw new Error('기간 시세 없음');
    const first = pts[0]!;
    const last = pts.at(-1)!;
    const chg = (last[1] / first[1] - 1) * 100;
    const hi = Math.max(...pts.map((p) => p[1]));
    const lo = Math.min(...pts.map((p) => p[1]));
    const cur = q.currency ?? '';
    const text = [
      `${q.name} (${sym}) daily closes over the last ${days} days (${cur}):`,
      ...pts.map((p) => `${p[0]}: ${p[1].toFixed(2)}`),
      `Change from ${first[0]} close ${first[1].toFixed(2)} to ${last[0]} close ${last[1].toFixed(2)}: ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%. Period high ${hi.toFixed(2)}, low ${lo.toFixed(2)}.`,
    ].join('\n');
    const src = this.register({ kind: 'quote', title: `${q.name} (${sym}) — ${days}D`, publisher: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/history`, published: Date.now() }, text);
    return { result: { source: src.id, text }, status: `${this.lang === 'ko' ? `최근 ${days}일 시세` : `${days}-day prices`}: ${sym}`, newSource: src };
  }

  private openCompany(symbol: string) {
    const sym = symbol.toUpperCase();
    if (!SYMBOL_RE.test(sym)) throw new Error('잘못된 티커');
    const already = this.screen?.company?.toUpperCase() === sym;
    this.screen = { view: this.screen?.view === 'AI' ? 'HOME' : this.screen?.view ?? 'HOME', company: sym, drawer: true };
    return { result: this.opened(sym, already), status: `${this.lang === 'ko' ? '회사 페이지 열기' : 'Opening company page'}: ${sym}`, ui: { kind: 'company' as const, symbol: sym } };
  }

  private openScreen(code: string) {
    const c = code.toUpperCase() as ViewCode;
    if (!VIEW_CODES.includes(c) || c === 'AI' || c === 'HELP') throw new Error(`없는 화면: ${code}`);
    const already = isShowing(this.screen, c);
    // 전체 화면 에이전트에서 열면 대화는 옆 창으로 옮겨 간다
    this.screen = { view: c, company: null, drawer: true };
    return { result: this.opened(c, already), status: `${this.lang === 'ko' ? '화면 열기' : 'Opening screen'}: ${c}`, ui: { kind: 'view' as const, code: c } };
  }

  private opened(what: string, already: boolean) {
    const ko = this.lang === 'ko';
    return {
      opened: what,
      alreadyOpen: already,
      screenNow: describeScreen(this.screen, this.lang),
      note: ko
        ? `${already ? '이미 열려 있던 화면을 다시 띄웠다.' : '사용자 화면에 열었다.'} 다른 요청이 없으면 한 문장으로만 알리고 끝낸다.`
        : `${already ? 'It was already open; shown again.' : 'Opened on the user\'s screen.'} Unless they asked for more, confirm in one sentence and stop.`,
    };
  }

  private async getJournal(symbol: string, limitRaw: number) {
    const limit = Math.min(Math.max(1, Math.round(limitRaw)), 30);
    const { trades } = await journalTrades();
    // 최근 limit 건을 시간순(오래된 것 먼저)으로 — 최신순으로 주면 작은 모델이 순서를 거꾸로 읽는다
    const list = trades.filter((t) => t.source !== 'initial' && (!symbol || t.symbol === symbol)).slice(0, limit).reverse();
    const ko = this.lang === 'ko';
    const text = list.length
      ? `${ko ? '시간순(위가 먼저)' : 'Chronological (oldest first)'}\n\n${list.map((t, i) => `#${i + 1}\n${tradeSourceText(t, this.lang)}`).join('\n\n')}`
      : (ko ? '기록된 매매가 없다(포트폴리오 수량을 바꾸면 매매로 기록된다).' : 'No trades recorded yet (changing portfolio quantities records trades).');
    const src = this.register({ kind: 'journal', title: ko ? `매매일지${symbol ? ` — ${symbol}` : ''} (${list.length}건)` : `Trading journal${symbol ? ` — ${symbol}` : ''} (${list.length})`, publisher: 'Macro Terminal', published: Date.now() }, text);
    return { result: { source: src.id, text }, status: `${ko ? '매매일지 보기' : 'Reading journal'}${symbol ? `: ${symbol}` : ''}`, newSource: src };
  }

  private async getBehavior() {
    const { trades } = await journalTrades();
    const p = computeProfile(trades);
    const ko = this.lang === 'ko';
    const f = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
    const text = [
      `${ko ? '판단 거래' : 'decision trades'}: ${p.trades}, ${ko ? '매도' : 'sells'}: ${p.sells}`,
      `${ko ? '30일 시장 대비 적중률' : '30-day hit rate vs market'}: ${p.hitRate30 == null ? 'n/a' : `${(p.hitRate30 * 100).toFixed(0)}%`}, ${ko ? '평균' : 'avg'} ${f(p.avgEdge30)}`,
      ...p.patterns.map((x) => `${x.id}: ${!x.enough ? (ko ? '판단하기엔 거래가 적음' : 'not enough trades') : x.flagged ? (ko ? '보임' : 'present') : (ko ? '뚜렷하지 않음' : 'not evident')} — ${x.count}/${x.total}${x.metric != null ? `, metric ${x.metric.toFixed(2)}` : ''}, edge ${f(x.edgeHit)} vs ${f(x.edgeRest)}`),
      p.emotions.length ? `${ko ? '감정별' : 'by emotion'}: ${p.emotions.map((e) => `${e.label} ${e.count} (edge ${f(e.avgEdge30)})`).join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const src = this.register({ kind: 'journal', title: ko ? '행동 패턴' : 'Behavior profile', publisher: 'Macro Terminal', published: Date.now() }, text);
    return { result: { source: src.id, text }, status: ko ? '행동 패턴 보기' : 'Reading behavior profile', newSource: src };
  }

  private async findSimilar(symbol: string, side: 'buy' | 'sell') {
    if (!SYMBOL_RE.test(symbol)) throw new Error('잘못된 티커');
    const { trades } = await journalTrades();
    const similar = similarTrades(trades, { symbol, side, memo: '', emotions: [], priorMove: null, industry: this.portfolio.holdings.find((h) => h.symbol.toUpperCase() === symbol)?.industry ?? null, strategy: null }, this.portfolio, this.lang);
    const ko = this.lang === 'ko';
    const text = similar.length
      ? similar.map((x, i) => `#${i + 1} (${x.reasons.join(', ')})\n${tradeSourceText(x.trade, this.lang)}`).join('\n\n')
      : (ko ? '비슷한 과거 매매가 없다.' : 'No similar past trades.');
    const src = this.register({ kind: 'journal', title: ko ? `비슷한 과거 매매 — ${symbol}` : `Similar past trades — ${symbol}`, publisher: 'Macro Terminal', published: Date.now() }, text);
    return { result: { source: src.id, text }, status: `${ko ? '비슷한 과거 매매 찾기' : 'Finding similar trades'}: ${symbol}`, newSource: src };
  }

  private async searchSymbols(query: string) {
    if (!query) throw new Error('query 가 필요합니다');
    const res = await search(query, this.settings, this.portfolio, { deep: true });
    const results = res.results
      .filter((r) => r.symbol || r.entity)
      .slice(0, 6)
      .map((r) => ({ symbol: r.symbol ?? null, listed: !!r.symbol, name: r.titleEn ?? r.title, korean: r.title, kind: r.kind, exchange: r.sub ?? null }));
    return { result: { query, results }, status: `${this.lang === 'ko' ? '종목 찾기' : 'Finding ticker'}: ${query}` };
  }
}
