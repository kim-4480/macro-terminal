import type { Emotion, InfoSource, PatternId, Strategy, TimeHorizon } from '@/shared/journal';
import { LOCALE_PACKS } from '@/locales';
import { deepMerge } from '@/shared/deep-merge';
import type { BaseLang, Lang } from '@/shared/types';

// 모의 매매 앱(/trade) 문구. 터미널 문구(lib/strings)와 따로 둬서 터미널이 가벼운 채로 있게 한다.

/** 모의 매매·매매일지 문구 */
export interface JournalStrings {
  tabs: Record<'balance' | 'fills' | 'analysis' | 'quotes', string>;
  sum: Record<'value' | 'cost' | 'unrealized' | 'realized' | 'since' | 'notStarted', string>;
  th: Record<'name' | 'qty' | 'avg' | 'last' | 'value' | 'pnl' | 'pct' | 'date' | 'side' | 'price' | 'amount' | 'realized' | 'memo' | 'emotion' | 'd7' | 'd30' | 'd90', string>;
  order: Record<'title' | 'buy' | 'sell' | 'symbol' | 'symbolHint' | 'qty' | 'price' | 'market' | 'amount' | 'held' | 'industry' | 'pickIndustry' | 'submitBuy' | 'submitSell' | 'confirm' | 'working' | 'done' | 'mock' | 'check' | 'checking' | 'noHolding' | 'newSymbol', string>;
  cap: Record<'title' | 'subtitle' | 'memo' | 'memoHint' | 'plan' | 'planHint' | 'followed' | 'yes' | 'partial' | 'no' | 'target' | 'stop' | 'save' | 'skip' | 'saving' | 'later', string>;
  dec: Record<'waiting' | 'title' | 'rationale' | 'emotions' | 'sources' | 'strategy' | 'horizon' | 'pending' | 'error' | 'retry' | 'confirm' | 'confirmed' | 'edit' | 'unverified' | 'verified' | 'chatUsed' | 'none' | 'writeMemo' | 'editMemo' | 'noMemo' | 'initial', string>;
  out: Record<'title' | 'market' | 'edge' | 'final' | 'soFar' | 'none' | 'edgeHint', string>;
  an: Record<'title' | 'you' | 'ai' | 'hit' | 'avgEdge' | 'decisions' | 'opinions' | 'patterns' | 'emotionsTitle' | 'notEnough' | 'flagged' | 'clear' | 'affected' | 'rest' | 'aiTitle' | 'noOpinions' | 'stance' | 'empty' | 'scoreHint', string>;
  coach: Record<'title' | 'similar' | 'none' | 'fail', string>;
  emotion: Record<Emotion, string>;
  source: Record<InfoSource, string>;
  strategy: Record<Strategy, string>;
  horizon: Record<TimeHorizon, string>;
  pattern: Record<PatternId, { name: string; desc: string; metric: (v: number) => string }>;
  stance: Record<'up' | 'down' | 'neutral', string>;
}


export const TR: Record<BaseLang, JournalStrings> = {
  ko: {
      tabs: { balance: '잔고', fills: '체결 내역', analysis: '매매 분석', quotes: '시세' },
      sum: { value: '평가금액', cost: '매입금액', unrealized: '평가손익', realized: '실현손익', since: '기록 시작', notStarted: '아직 기록 전(첫 화면을 열면 지금 보유분을 기초 보유로 잡습니다)' },
      th: { name: '종목', qty: '보유수량', avg: '평균단가', last: '현재가', value: '평가금액', pnl: '평가손익', pct: '수익률', date: '날짜', side: '구분', price: '체결가', amount: '체결금액', realized: '실현손익', memo: '메모', emotion: '감정', d7: '7일', d30: '30일', d90: '90일' },
      order: { title: '주문', buy: '매수', sell: '매도', symbol: '종목', symbolHint: '티커(예: 005930.KS, NVDA)', qty: '수량', price: '가격', market: '시장가(최근 종가)', amount: '주문금액', held: '보유', industry: '업계', pickIndustry: '업계 선택', submitBuy: '매수 주문', submitSell: '매도 주문', confirm: '주문할까요?', working: '주문 중', done: '체결됐습니다', mock: '모의 주문 — 실제 계좌와 연결되지 않습니다. 체결하면 포트폴리오 수량이 바뀝니다.', check: '주문 전 점검', checking: '과거 매매와 비교하는 중', noHolding: '보유하지 않은 종목입니다', newSymbol: '새 종목 — 업계를 고르세요' },
      cap: { title: '방금 거래 기록', subtitle: '짧게라도 남겨 두면 나중에 손익의 원인을 함께 돌아볼 수 있습니다.', memo: '왜 샀나요/팔았나요?', memoHint: '예: 실적 발표 전에 오를 것 같아서. 많이 올라 놓칠까 봐 조급했다.', plan: '미리 세운 계획', planHint: '예: 실적 발표까지 보유, -8%면 손절', followed: '계획대로 했나요?', yes: '예', partial: '일부', no: '아니오', target: '목표가', stop: '손절가', save: '저장', skip: '건너뛰기', saving: '저장 중', later: '나중에 체결 내역에서 쓸 수 있습니다' },
      dec: { waiting: '판단 분석 대기 중(로컬 모델이 꺼져 있었습니다).', title: '판단 분석', rationale: '판단 근거', emotions: '감정 후보', sources: '정보 출처', strategy: '전략', horizon: '보유 기간', pending: '에이전트가 메모를 분석하는 중', error: '분석 실패', retry: '다시 분석', confirm: '이대로 확인', confirmed: '확인함', edit: '감정 고치기', unverified: '근거 발췌가 메모·대화에 없음', verified: '메모·대화에서 확인', chatUsed: '그 무렵 대화 {n}개 참고', none: '드러난 감정 없음', writeMemo: '메모 쓰기', editMemo: '메모 고치기', noMemo: '메모 없음', initial: '기초 보유(분석 제외)' },
      out: { title: '사후 성과', market: '시장', edge: '시장 대비', final: '확정', soFar: '진행 중', none: '아직 기간이 지나지 않았습니다', edgeHint: '매수는 (주가 - 지수), 매도는 (지수 - 주가). 플러스면 시장보다 나은 판단.' },
      an: { title: '매매 분석', you: '내 판단', ai: 'AI 의견', hit: '30일 적중률', avgEdge: '30일 평균 시장 대비', decisions: '판단 거래', opinions: '의견', patterns: '행동 패턴', emotionsTitle: '감정별 결과', notEnough: '거래가 더 쌓여야 판단할 수 있습니다', flagged: '보임', clear: '뚜렷하지 않음', affected: '해당 거래', rest: '나머지', aiTitle: 'AI 자기평가 — 에이전트가 낸 해석을 같은 기준으로 채점', noOpinions: '아직 기록된 AI 의견이 없습니다(에이전트 답의 "해석:" 문장이 기록됩니다)', stance: '방향', empty: '아직 기록된 매매가 없습니다. 주문창이나 포트폴리오 편집으로 수량을 바꾸면 매매로 기록됩니다.', scoreHint: '확정된 30일 결과 기준. 시장 대비 플러스인 비율.' },
      coach: { title: '점검 질문', similar: '비슷한 과거 매매', none: '비슷한 과거 매매가 아직 없습니다', fail: '점검 질문을 만들지 못했습니다' },
      emotion: { fomo: '놓칠까 조급', fear: '공포', greed: '욕심', regret: '후회', overconfidence: '과신', impatience: '조급함', anxiety: '불안', revenge: '만회 심리', calm: '차분', conviction: '확신' },
      source: { news: '뉴스', chart: '차트', community: '커뮤니티', acquaintance: '지인', ai_agent: 'AI 에이전트', report: '리포트', own_analysis: '직접 분석', other: '기타' },
      strategy: { momentum: '추세 추종', value: '가치', dip_buy: '저점 매수', earnings: '실적', news_event: '뉴스·이벤트', long_term: '장기 보유', rebalance: '비중 조절', stop_loss: '손절', take_profit: '익절', other: '기타' },
      horizon: { intraday: '당일', days: '며칠', weeks: '몇 주', months: '몇 달', years: '몇 년', unknown: '모름' },
      pattern: {
        loss_aversion: { name: '손실 회피', desc: '손실 난 종목을 이익 난 종목보다 오래 들고 있습니다.', metric: (v) => `손실 보유 기간이 이익의 ${v.toFixed(1)}배` },
        impulsive: { name: '충동 매매', desc: '조급·욕심·만회 같은 감정이 드러나거나 계획 없이 한 거래.', metric: (v) => `기록한 거래의 ${(v * 100).toFixed(0)}%` },
        quick_rebuy: { name: '단기 재매수', desc: '판 지 7일 안에 같은 종목을 다시 샀습니다.', metric: (v) => `${v.toFixed(0)}번` },
        plan_deviation: { name: '계획 이탈', desc: '계획대로 하지 않았다고 답했거나 손절가보다 한참 아래에서 판 거래.', metric: (v) => `계획을 적은 거래의 ${(v * 100).toFixed(0)}%` },
        overtrading: { name: '과매매', desc: '거래가 잦습니다(주당 4회 이상).', metric: (v) => `주당 ${v.toFixed(1)}회` },
        chasing: { name: '추격 매매', desc: '5거래일 +8% 넘게 오른 뒤 사거나, -8% 넘게 내린 뒤 판 거래.', metric: (v) => `거래의 ${(v * 100).toFixed(0)}%` },
      },
      stance: { up: '상승', down: '하락', neutral: '중립' },
    },
  en: {
      tabs: { balance: 'Balance', fills: 'Fills', analysis: 'Analysis', quotes: 'Quotes' },
      sum: { value: 'Market value', cost: 'Cost', unrealized: 'Unrealized P&L', realized: 'Realized P&L', since: 'Recording since', notStarted: 'Not started (opening this screen records current holdings as the starting position)' },
      th: { name: 'Name', qty: 'Qty', avg: 'Avg price', last: 'Last', value: 'Value', pnl: 'P&L', pct: 'Return', date: 'Date', side: 'Side', price: 'Fill price', amount: 'Amount', realized: 'Realized', memo: 'Note', emotion: 'Emotion', d7: '7D', d30: '30D', d90: '90D' },
      order: { title: 'Order', buy: 'Buy', sell: 'Sell', symbol: 'Symbol', symbolHint: 'Ticker (e.g. 005930.KS, NVDA)', qty: 'Quantity', price: 'Price', market: 'Market (last close)', amount: 'Order amount', held: 'Held', industry: 'Industry', pickIndustry: 'Pick an industry', submitBuy: 'Place buy', submitSell: 'Place sell', confirm: 'Place this order?', working: 'Placing', done: 'Filled', mock: 'Paper order — not connected to a real account. Filling changes your portfolio quantity.', check: 'Pre-trade check', checking: 'Comparing with past trades', noHolding: 'Not held', newSymbol: 'New symbol — pick an industry' },
      cap: { title: 'Log this trade', subtitle: 'A few words now help you review what drove the result later.', memo: 'Why did you buy/sell?', memoHint: 'e.g. Expected it to rise before earnings. It ran up and I was afraid of missing out.', plan: 'Your plan', planHint: 'e.g. Hold through earnings, stop at -8%', followed: 'Did you follow your plan?', yes: 'Yes', partial: 'Partly', no: 'No', target: 'Target', stop: 'Stop', save: 'Save', skip: 'Skip', saving: 'Saving', later: 'You can add it later from Fills' },
      dec: { waiting: 'Decision analysis waiting (the local model was off).', title: 'Decision analysis', rationale: 'Rationale', emotions: 'Emotion candidates', sources: 'Info sources', strategy: 'Strategy', horizon: 'Horizon', pending: 'Agent is analyzing the note', error: 'Analysis failed', retry: 'Analyze again', confirm: 'Confirm', confirmed: 'Confirmed', edit: 'Edit emotions', unverified: 'evidence not found in note/chat', verified: 'found in note/chat', chatUsed: 'used {n} chat messages from that time', none: 'No visible emotion', writeMemo: 'Write note', editMemo: 'Edit note', noMemo: 'No note', initial: 'Starting position (not analyzed)' },
      out: { title: 'Outcome', market: 'Market', edge: 'vs market', final: 'final', soFar: 'so far', none: 'Not enough time has passed', edgeHint: 'Buy: stock − index. Sell: index − stock. Positive means better than the market.' },
      an: { title: 'Trade analysis', you: 'Your decisions', ai: 'AI opinions', hit: '30D hit rate', avgEdge: '30D avg vs market', decisions: 'decisions', opinions: 'opinions', patterns: 'Behavior patterns', emotionsTitle: 'Results by emotion', notEnough: 'Needs more trades to judge', flagged: 'Present', clear: 'Not evident', affected: 'Affected', rest: 'Others', aiTitle: 'AI self-evaluation — the agent\'s interpretations scored the same way', noOpinions: 'No AI opinions yet (the agent\'s "Interpretation:" lines are recorded)', stance: 'Stance', empty: 'No trades yet. Changing quantities with the order panel or the portfolio editor records trades.', scoreHint: 'Based on final 30-day results: share beating the market.' },
      coach: { title: 'Questions to check', similar: 'Similar past trades', none: 'No similar past trades yet', fail: 'Could not create check questions' },
      emotion: { fomo: 'FOMO', fear: 'Fear', greed: 'Greed', regret: 'Regret', overconfidence: 'Overconfidence', impatience: 'Impatience', anxiety: 'Anxiety', revenge: 'Revenge', calm: 'Calm', conviction: 'Conviction' },
      source: { news: 'News', chart: 'Chart', community: 'Community', acquaintance: 'Acquaintance', ai_agent: 'AI agent', report: 'Report', own_analysis: 'Own analysis', other: 'Other' },
      strategy: { momentum: 'Momentum', value: 'Value', dip_buy: 'Buy the dip', earnings: 'Earnings', news_event: 'News/event', long_term: 'Long term', rebalance: 'Rebalance', stop_loss: 'Stop loss', take_profit: 'Take profit', other: 'Other' },
      horizon: { intraday: 'Intraday', days: 'Days', weeks: 'Weeks', months: 'Months', years: 'Years', unknown: 'Unknown' },
      pattern: {
        loss_aversion: { name: 'Loss aversion', desc: 'You hold losers longer than winners.', metric: (v) => `losers held ${v.toFixed(1)}× as long` },
        impulsive: { name: 'Impulsive trades', desc: 'FOMO, greed or revenge shows, or no plan.', metric: (v) => `${(v * 100).toFixed(0)}% of logged trades` },
        quick_rebuy: { name: 'Quick rebuys', desc: 'Bought the same stock back within 7 days of selling.', metric: (v) => `${v.toFixed(0)} times` },
        plan_deviation: { name: 'Plan deviation', desc: 'Said you did not follow the plan, or sold well below your stop.', metric: (v) => `${(v * 100).toFixed(0)}% of planned trades` },
        overtrading: { name: 'Overtrading', desc: 'Frequent trading (4+ per week).', metric: (v) => `${v.toFixed(1)} per week` },
        chasing: { name: 'Chasing', desc: 'Bought after a +8% 5-day run or sold after a −8% drop.', metric: (v) => `${(v * 100).toFixed(0)}% of trades` },
      },
      stance: { up: 'Up', down: 'Down', neutral: 'Neutral' },
    },
};

/** 해당 언어 문구. 언어 묶음이 번역하지 않은 항목은 영어로 채운다 */
export const tradeStringsFor = (lang: Lang): JournalStrings =>
  (lang === 'ko' || lang === 'en' ? TR[lang] : deepMerge(TR.en, LOCALE_PACKS.find((p) => p.code === lang)?.trade));
