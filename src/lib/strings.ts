import { LOCALE_PACKS } from '@/locales';
import { deepMerge } from '@/shared/deep-merge';
import type { ArticleFailure, BaseLang, Lang, SearchKind, ViewCode } from '@/shared/types';

// 화면 문구. 데이터 이름은 config 의 label / labelEn 을 쓴다.
export interface Strings {
  locale: string;
  cmdPlaceholder: string;
  cmdLabel: string;
  views: Record<ViewCode, string>;
  panels: Record<Exclude<ViewCode, 'HOME'>, string>;
  groups: Record<string, string>;
  th: Record<'indicator' | 'value' | 'asOf' | 'prior' | 'trend' | 'market' | 'last' | 'holding' | 'industry' | 'weight' | 'price' | 'bench' | 'y1' | 'tenor', string>;
  ecosKey: string;
  loadFail: string;
  total: string;
  dayPnl: string;
  fxNote: (pair: string, rate: string, base: string) => string;
  curve: Record<'now' | 'm1' | 'y1' | 'shape' | 'inverted' | 'flat' | 'normal', string>;
  news: Record<'autoOff' | 'enrichNow' | 'loading' | 'llmOff' | 'working' | 'waitingNet' | 'fail' | 'related' | 'none', string>;
  ago: (minutes: number) => string;
  brief: Record<'generate' | 'writing' | 'waitingNet' | 'none' | 'past', string> & { kinds: Record<'daily' | 'weekly' | 'monthly', string>; generateKind: Record<'daily' | 'weekly' | 'monthly', string>; noneKind: (kind: string) => string; writingKind: (kind: string) => string };
  gp: Record<'loading' | 'short' | 'close', string>;
  prof: Record<'title' | 'sector' | 'country' | 'cap' | 'pe' | 'pb' | 'div' | 'range' | 'emp' | 'translating' | 'none', string>;
  map: Record<'all' | 'located' | 'unlocated' | 'countries' | 'pick' | 'tagging' | 'keywordOnly' | 'noNews' | 'global' | 'stories' | 'clear', string>;
  chat: { title: string; open: string; placeholder: string; send: string; stop: string; clear: string; close: string; offline: string; hint: string; failed: string; sources: string; verified: (q: [number, number], n: [number, number]) => string; notFound: string; uncited: (n: number) => string; partial: string; unread: string; expand: string; collapse: string; steps: (n: number) => string; working: string; needApproval: string; approve: string; reject: string; approved: string; rejected: string; expired: string; sending: string; qty: string; industry: string; pickIndustry: string; sandbox: string; newChat: string; recent: string; menu: string; remove: string; noSessions: string; answering: string };
  art: Record<'badge' | 'open' | 'loading' | 'partial' | 'fail' | 'close' | 'note' | 'translate' | 'transNote' | 'transWorking' | 'transOffline' | 'transFail' | 'transSkipped' | 'retry', string> & { reasons: Record<ArticleFailure, string> };
  co: Record<'unlisted' | 'unlistedNote' | 'back' | 'news' | 'briefing' | 'toggle' | 'generate' | 'regenerate' | 'writing' | 'waitingNet' | 'noBriefing' | 'offline' | 'generated' | 'holding' | 'qty' | 'range52' | 'last' | 'addToPortfolio' | 'inPortfolio' | 'noNews' | 'newsWorking' | 'chart', string>;
  eco: { addPlaceholder: string; add: string; ask: (q: string) => string };
  pe: Record<'labelHint' | 'autofill' | 'filling' | 'fillFail' | 'title' | 'edit' | 'holdings' | 'industries' | 'symbol' | 'name' | 'nameEn' | 'industry' | 'qty' | 'add' | 'remove' | 'addIndustry' | 'label' | 'labelEn' | 'benchmark' | 'kwEn' | 'kwKo' | 'save' | 'cancel' | 'saving' | 'saved' | 'qtyHint' | 'find' | 'empty' | 'industryHint' | 'confirmLeave', string>;
  pf: Record<'holdings' | 'range' | 'mode' | 'grid' | 'rows', string>;
  banner: string;
  offline: string;
  llmOn: string;
  llmOff: string;
  llmAuth: string;
  setup: Record<'title' | 'intro' | 'language' | 'preset' | 'presetGlobal' | 'presetKorea' | 'presetNote' | 'currency' | 'currencyNote' | 'llm' | 'kind' | 'baseUrl' | 'model' | 'modelHint' | 'apiKey' | 'apiKeyKept' | 'apiKeyEnv' | 'test' | 'testing' | 'testChat' | 'testJson' | 'testTools' | 'testOffline' | 'testAuth' | 'privacy' | 'background' | 'backgroundNote' | 'ecos' | 'save' | 'saving' | 'needModel', string> & { kinds: Record<string, string> };
  search: { searching: string; none: string; via: (q: string) => string; unverified: string; unverifiedHint: string; kinds: Record<SearchKind, string> };
}

export const STRINGS: Record<BaseLang, Strings> = {
  ko: {
    locale: 'ko-KR',
    cmdPlaceholder: '명령어·종목명·티커·지표 검색 (예: 엔비디아, 삼성전자, 실업률, GC)',
    cmdLabel: '명령어 또는 검색',
    views: { HOME: '홈', ECO: '거시', MKT: '시장', GC: '금리곡선', PORT: '포트폴리오', N: '뉴스', MAP: '지도', BRIEF: '브리핑', AI: '에이전트', HELP: '도움말' },
    panels: { ECO: '거시경제 지표', MKT: '글로벌 시장', GC: '미국 국채 금리 곡선', PORT: '내 포트폴리오', N: '업계·거시 뉴스', MAP: '뉴스 지도', BRIEF: '브리핑', AI: 'AI 에이전트', HELP: '사용법' },
    groups: { 미국: '미국', 유럽: '유럽', 한국: '한국', 중국: '중국', 일본: '일본', 글로벌: '글로벌 위험·유동성' },
    th: { indicator: '지표', value: '값', asOf: '기준일', prior: '직전', trend: '1년 추이', market: '시장', last: '현재', holding: '종목', industry: '업계', weight: '비중', price: '현재가', bench: '업계지표 1M', y1: '1년', tenor: '만기' },
    ecosKey: 'ECOS 인증키 필요',
    loadFail: '불러오지 못했습니다',
    total: '평가액',
    dayPnl: '오늘 손익(추정)',
    fxNote: (pair, r, base) => `환율 ${pair} ${r} 기준 ${base} 환산 · 손익은 환율 변동 제외 추정치`,
    curve: { now: '현재', m1: '1개월 전', y1: '1년 전', shape: '형태', inverted: '역전', flat: '평탄', normal: '정상(우상향)' },
    news: {
      loading: '뉴스를 불러오는 중',
      llmOff: '모델이 연결되어 있지 않아 원문만 표시합니다. 설정(/setup)에서 연결하면 번역·요약이 붙습니다.',
      working: '에이전트가 번역·요약하는 중',
      waitingNet: '인터넷 연결이 끊겨 일시 중지됨 — 연결되면 자동으로 이어서 합니다',
      fail: '요약 실패',
      related: '관련 보유 종목',
      none: '최근 뉴스가 없습니다.',
      autoOff: '자동 번역·요약이 꺼져 있습니다.',
      enrichNow: '지금 번역·요약',
    },
    ago: (m) => (m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`),
    brief: {
      generate: '새 브리핑 생성',
      writing: '에이전트가 브리핑을 쓰는 중 (1~3분)',
      waitingNet: '인터넷 연결이 끊겨 일시 중지됨 — 연결되면 자동으로 이어서 씁니다',
      none: '아직 이 언어의 브리핑이 없습니다. 모델을 연결한 뒤 “새 브리핑 생성”을 누르세요.',
      past: '지난 브리핑',
      kinds: { daily: '일간', weekly: '주간', monthly: '월간' },
      generateKind: { daily: '새 일간 브리핑', weekly: '새 주간 브리핑', monthly: '새 월간 브리핑' },
      noneKind: (k) => `아직 ${k} 브리핑이 없습니다. 모델을 연결한 뒤 생성 버튼을 누르세요.`,
      writingKind: (k) => `에이전트가 ${k} 브리핑을 쓰는 중 (2~5분)`,
    },
    gp: { loading: '불러오는 중', short: '데이터가 부족합니다.', close: '닫기' },
    prof: { title: '기업 개요 (yfinance)', sector: '업종', country: '국가', cap: '시가총액', pe: 'PER (현재/예상)', pb: 'PBR', div: '배당수익률', range: '52주 범위', emp: '직원 수', translating: '에이전트가 설명을 번역하는 중', none: '기업 개요를 가져오지 못했습니다' },
    map: {
      all: '전체', located: '위치 확인', unlocated: '위치 불명·글로벌', countries: '나라별 뉴스', pick: '지도에서 나라나 점을 누르면 그곳 뉴스만 봅니다',
      tagging: '에이전트가 기사 위치를 찾는 중', keywordOnly: '모델 태깅이 꺼져 있어 키워드로 대략 표시합니다', noNews: '이 나라 뉴스가 없습니다.', global: '글로벌·위치 불명', stories: '건', clear: '전체 보기',
    },
    chat: {
      title: 'AI 리서치', open: '질문', placeholder: '터미널 데이터에 대해 물어보세요 (Enter 전송, Shift+Enter 줄바꿈)', send: '보내기', stop: '중지', clear: '새 대화', close: '닫기',
      offline: '모델이 연결되어 있지 않아 답할 수 없습니다. 설정(/setup)을 확인하세요.', hint: '에이전트가 질문에 답하고, 시킨 작업도 수행합니다. 터미널 데이터와 직접 검색·읽은 기사를 근거로 답합니다. 사실마다 출처 본문의 발췌를 붙이고, 발췌가 원문에 있는지 자동으로 대조합니다. 매매 권유는 하지 않습니다.', failed: '답변을 받지 못했습니다',
      sources: '근거', verified: ([qo, qt], [no, nt]) => `근거 확인: 발췌 ${qo}/${qt} 원문 일치${nt ? ` · 숫자 ${no}/${nt} 확인` : ''}`,
      notFound: '원문에서 찾지 못함', uncited: (n) => `발췌 없이 근거 번호만 붙은 문장 ${n}개`, partial: '본문 대신 요약만 읽음', unread: '제목만 확인(본문 안 읽음)',
      expand: '크게 보기', collapse: '작게 보기', steps: (n) => `작업 ${n}단계`, working: '작업 중',
      needApproval: '승인 필요', approve: '승인', reject: '거절', approved: '승인됨', rejected: '거절됨', expired: '만료됨 — 다시 요청하세요', sending: '처리 중',
      qty: '수량', industry: '업계', pickIndustry: '업계 선택',
      newChat: '새 대화', recent: '최근 대화', menu: '메뉴', remove: '대화 삭제', noSessions: '아직 대화가 없습니다', answering: '답하는 중',
      sandbox: '에이전트는 이 터미널 안의 작업(검색·시세·뉴스·포트폴리오·화면 열기)만 할 수 있고, 포트폴리오를 바꾸기 전에는 항상 승인을 받습니다.',
    },
    art: {
      reasons: {
        'google-blocked': '구글 뉴스가 자동 접속을 잠시 막아 원문 주소를 찾지 못했고, 빙 뉴스에서도 같은 제목의 기사를 찾지 못했습니다. 위 링크로 직접 보거나 나중에 다시 열어 보세요.',
        google: '구글 뉴스에서 원문 주소를 찾지 못했고, 빙 뉴스에서도 같은 제목의 기사를 찾지 못했습니다. 위 링크로 직접 보세요.',
        'site-blocked': '언론사가 자동 접속을 막아 본문을 받지 못했습니다. 위 링크로 직접 보세요.',
        'no-body': '이 페이지에서 기사 본문을 찾지 못했습니다. 위 링크로 직접 보세요.',
        network: '기사 사이트에 연결하지 못했습니다. 위 링크로 직접 보거나 나중에 다시 열어 보세요.',
      },
      translate: '번역', transNote: '에이전트가 번역한 글입니다. 오역이 있을 수 있으니 중요한 내용은 원문을 확인하세요.', transWorking: '번역하는 중입니다. 끝난 문단부터 바뀝니다.', transOffline: '언어 모델이 꺼져 있어 번역할 수 없습니다.', transFail: '번역을 끝내지 못했습니다', transSkipped: '일부는 번역하지 못해 원문으로 두었습니다.', retry: '다시 시도',
      badge: '기사', open: '원문 기사 보기', loading: '기사 본문을 불러오는 중', close: '닫기',
      partial: '본문 전체를 가져오지 못해 기사 요약만 보입니다. 전체 내용은 원문에서 확인하세요.',
      fail: '이 기사는 본문을 가져오지 못했습니다. 위의 원문 링크로 확인하세요.',
      note: '아래 본문은 원문 그대로입니다(번역·요약하지 않음).',
    },
    co: {
      unlisted: '비상장 기업', unlistedNote: '상장되지 않아 주가·차트는 없습니다. 이 회사 뉴스와 AI 브리핑을 볼 수 있어요.',
      back: '← 돌아가기', news: '관련 뉴스', briefing: 'AI 브리핑', toggle: 'AI 브리핑 켜기', generate: '브리핑 생성', regenerate: '다시 생성',
      writing: '에이전트가 이 회사 브리핑을 쓰는 중 (1~2분)', waitingNet: '인터넷 연결이 끊겨 일시 중지됨 — 연결되면 이어서 씁니다', noBriefing: '아직 이 회사 브리핑이 없습니다.',
      offline: '모델이 연결되어 있지 않아 브리핑을 만들 수 없습니다.', generated: '생성', holding: '보유 중', qty: '수량', range52: '52주 범위', last: '기준일',
      addToPortfolio: '+ 포트폴리오에 추가', inPortfolio: '내 포트폴리오', noNews: '최근 3일간 이 회사 뉴스가 없습니다.', newsWorking: '에이전트가 뉴스를 번역·요약하는 중', chart: '주가',
    },
    eco: { addPlaceholder: '추가할 지표 (예: 독일 실업률)', add: '에이전트에게 요청', ask: (q) => `거시경제 지표에 추가해 줘: ${q}` },
    pe: {
      labelHint: '예: 조선, 방산, 2차전지', autofill: '자동 채우기', filling: '에이전트가 채우는 중', fillFail: '자동 채우기 실패 — 직접 입력하세요',
      title: '포트폴리오 편집', edit: '편집', holdings: '보유 종목', industries: '업계', symbol: '티커', name: '이름', nameEn: '영어 이름', industry: '업계', qty: '수량',
      add: '+ 종목 추가', remove: '삭제', addIndustry: '+ 업계 추가', label: '업계 이름', labelEn: '영어 이름', benchmark: '업계 지표(티커)',
      kwEn: '영어 뉴스 검색어(쉼표로 구분)', kwKo: '한국어 뉴스 검색어(쉼표로 구분)', save: '저장', cancel: '취소', saving: '저장 중', saved: '저장했습니다',
      qtyHint: '수량을 모두 넣으면 평가액과 비중을 계산합니다(비우면 같은 비중)', find: '종목명·티커로 찾기', empty: '종목이 없습니다. 아래에서 추가하세요.',
      industryHint: '업계 이름만 넣으면 에이전트가 영어 이름·대표 지표·뉴스 검색어를 채웁니다. 종목마다 업계를 고르면 그 업계 뉴스·성과·지도가 묶여 보입니다.', confirmLeave: '저장하지 않은 변경이 있습니다. 닫을까요?',
    },
    pf: { holdings: '종목', range: '차트 기간', mode: '보기 방식', grid: '그리드', rows: '한 줄씩' },
    banner: '예시 포트폴리오를 보고 있습니다. 포트폴리오 패널의 "편집"을 눌러 실제 보유 종목으로 바꾸세요.',
    offline: '인터넷 연결 없음 — 마지막으로 받은 데이터를 보여주고, 백그라운드 작업은 연결되면 이어서 합니다.',
    llmOn: '● AGENT',
    llmOff: '○ AGENT 오프라인',
    llmAuth: '○ AGENT 키 오류',
    setup: {
      title: 'Macro Terminal 설정', intro: '언어와 모델을 정하면 시작합니다. 모델 없이도 지표·시장·뉴스 원문은 볼 수 있습니다. 나중에 이 화면(/setup)에서 언제든 바꿀 수 있습니다.',
      language: '언어', preset: '기본 구성', presetGlobal: '글로벌 (세계 시장, 미국 종목 예시)', presetKorea: '한국 (한국 시장, 국내 종목 예시)', presetNote: '거시 지표는 미국이 기본입니다. 다른 나라 지표는 에이전트에게 말하면 찾아서 추가합니다. 구성을 바꾸면 시장 목록이 바뀌고, 포트폴리오는 아직 예시일 때만 함께 바뀝니다.',
      currency: '기준 통화', currencyNote: '평가액과 손익을 이 통화로 환산합니다. 매매 기록이 쌓인 뒤에는 바꾸지 마세요(기록의 환율이 이 통화 기준입니다).',
      llm: '모델 연결', kind: '종류', baseUrl: '서버 주소', model: '모델', modelHint: '연결 시험을 하면 서버의 모델 목록을 고를 수 있습니다', apiKey: 'API 키', apiKeyKept: '저장된 키 유지 (바꾸려면 입력)', apiKeyEnv: '.env 의 LLM_API_KEY 를 쓰는 중입니다',
      test: '연결 시험', testing: '시험하는 중', testChat: '답변', testJson: '구조화 출력', testTools: '도구 호출', testOffline: '서버에 연결하지 못했습니다', testAuth: 'API 키가 거부되었습니다',
      privacy: '이 주소는 이 컴퓨터 밖의 서비스입니다. 포트폴리오, 매매 메모, 대화 내용과 그 감정 분석이 이 제공자에게 전송되고, 호출마다 요금이 나갈 수 있습니다.',
      background: '자동으로 모델 호출', backgroundNote: '뉴스 번역·요약, 지도 위치 태깅, 사업 설명 번역, 시작할 때 브리핑을 누르지 않아도 실행합니다. 원격 API 에서는 사용자가 모르는 사이 요금이 나갈 수 있어 기본으로 꺼 둡니다.',
      ecos: '한국은행 ECOS 인증키 (선택)', save: '저장하고 시작', saving: '저장하는 중', needModel: '모델 이름을 입력하세요',
      kinds: { ollama: 'Ollama (로컬)', llamacpp: 'llama.cpp (로컬)', lmstudio: 'LM Studio (로컬)', openai: 'OpenAI', anthropic: 'Anthropic (Claude)', gemini: 'Google Gemini', openrouter: 'OpenRouter', custom: '직접 입력 (OpenAI 호환)' },
    },
    search: {
      searching: '검색 중',
      none: '결과 없음 — 영어 이름이나 티커로도 찾아보세요',
      via: (q) => `에이전트가 찾은 이름: “${q}”`,
      unverified: '한글명 미확인', unverifiedHint: 'KRX·위키데이터·국내 기사에서 한국어 이름을 확인하지 못해 영어 이름으로 표시합니다',
      kinds: { fn: '화면', macro: '지표', market: '시장', holding: '보유', stock: '종목', index: '지수', topic: '뉴스', entity: '비상장' },
    },
  },
  en: {
    locale: 'en-US',
    cmdPlaceholder: 'Command, company, ticker or indicator (e.g. NVDA, Samsung, unemployment, GC)',
    cmdLabel: 'Command or search',
    views: { HOME: 'Home', ECO: 'Macro', MKT: 'Markets', GC: 'Curve', PORT: 'Portfolio', N: 'News', MAP: 'Map', BRIEF: 'Briefing', AI: 'Agent', HELP: 'Help' },
    panels: { ECO: 'Macro indicators', MKT: 'Global markets', GC: 'US Treasury yield curve', PORT: 'My portfolio', N: 'Industry & macro news', MAP: 'News map', BRIEF: 'Briefings', AI: 'AI agent', HELP: 'How to use' },
    groups: { 미국: 'United States', 유럽: 'Europe', 한국: 'Korea', 중국: 'China', 일본: 'Japan', 글로벌: 'Global risk & liquidity' },
    th: { indicator: 'Indicator', value: 'Value', asOf: 'As of', prior: 'Prior', trend: '1Y trend', market: 'Market', last: 'Last', holding: 'Holding', industry: 'Industry', weight: 'Weight', price: 'Price', bench: 'Bench 1M', y1: '1Y', tenor: 'Tenor' },
    ecosKey: 'ECOS API key required',
    loadFail: 'Failed to load',
    total: 'Value',
    dayPnl: "Today's P&L (est.)",
    fxNote: (pair, r, base) => `Converted to ${base} at ${pair} ${r} · P&L excludes FX moves (estimate)`,
    curve: { now: 'Now', m1: '1M ago', y1: '1Y ago', shape: 'Shape', inverted: 'Inverted', flat: 'Flat', normal: 'Normal (upward)' },
    news: {
      loading: 'Loading news',
      llmOff: 'No model connected, showing original headlines. Connect one in Setup (/setup) for translation and summaries.',
      working: 'Agent is translating and summarizing',
      waitingNet: 'Paused: no internet connection — resumes automatically when back online',
      fail: 'Summary failed',
      related: 'Related holdings',
      none: 'No recent news.',
      autoOff: 'Automatic translation and summaries are off.',
      enrichNow: 'Translate and summarize now',
    },
    ago: (m) => (m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`),
    brief: {
      generate: 'Generate briefing',
      writing: 'Agent is writing the briefing (1-3 min)',
      waitingNet: 'Paused: no internet connection — resumes automatically when back online',
      none: 'No briefing in this language yet. Connect a model, then press “Generate briefing”.',
      past: 'Past briefings',
      kinds: { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' },
      generateKind: { daily: 'New daily brief', weekly: 'New weekly brief', monthly: 'New monthly brief' },
      noneKind: (k) => `No ${k.toLowerCase()} briefing in this language yet. Connect a model, then press generate.`,
      writingKind: (k) => `Agent is writing the ${k.toLowerCase()} briefing (2-5 min)`,
    },
    gp: { loading: 'Loading', short: 'Not enough data.', close: 'Close' },
    prof: { title: 'Company profile (yfinance)', sector: 'Sector', country: 'Country', cap: 'Market cap', pe: 'P/E (TTM/fwd)', pb: 'P/B', div: 'Dividend yield', range: '52-week range', emp: 'Employees', translating: 'Agent is translating the description', none: 'Could not load the company profile' },
    map: {
      all: 'All', located: 'Located', unlocated: 'Global / unknown', countries: 'By country', pick: 'Click a country or dot to filter its news',
      tagging: 'Agent is locating stories', keywordOnly: 'Model tagging is off — rough placement by keywords', noNews: 'No news for this country.', global: 'Global / unknown', stories: 'stories', clear: 'Show all',
    },
    chat: {
      title: 'AI research', open: 'Ask', placeholder: 'Ask about the terminal data (Enter to send, Shift+Enter for a new line)', send: 'Send', stop: 'Stop', clear: 'New chat', close: 'Close',
      offline: 'No model connected. Check Setup (/setup).', hint: 'The agent answers questions and carries out tasks. It answers from terminal data and articles it searches and reads. Every fact carries an excerpt from the source, automatically checked against the original text. No buy/sell recommendations.', failed: 'No answer received',
      sources: 'Sources', verified: ([qo, qt], [no, nt]) => `Verified: ${qo}/${qt} excerpts match the source${nt ? ` · ${no}/${nt} numbers found` : ''}`,
      notFound: 'not found in source', uncited: (n) => `${n} sentence(s) cite a source without an excerpt`, partial: 'summary only (body unavailable)', unread: 'title only (body not read)',
      expand: 'Full screen', collapse: 'Side panel', steps: (n) => `${n} step${n === 1 ? '' : 's'}`, working: 'Working',
      needApproval: 'Approval needed', approve: 'Approve', reject: 'Reject', approved: 'Approved', rejected: 'Rejected', expired: 'Expired — ask again', sending: 'Working',
      qty: 'Quantity', industry: 'Industry', pickIndustry: 'Choose industry',
      newChat: 'New chat', recent: 'Recents', menu: 'Menu', remove: 'Delete chat', noSessions: 'No chats yet', answering: 'Answering',
      sandbox: 'The agent can only act inside this terminal (search, quotes, news, portfolio, screens) and always asks before changing your portfolio.',
    },
    art: {
      reasons: {
        'google-blocked': 'Google News is temporarily blocking automated access, and Bing News had no article with the same title. Use the link above or try again later.',
        google: 'Could not find the original address through Google News, and Bing News had no article with the same title. Use the link above.',
        'site-blocked': 'The publisher blocks automated access. Use the link above.',
        'no-body': 'Could not find the article text on this page. Use the link above.',
        network: 'Could not connect to the article site. Use the link above or try again later.',
      },
      translate: 'Translate', transNote: 'Translated by the agent and may contain errors. Check the original for anything important.', transWorking: 'Translating. Paragraphs change as they finish.', transOffline: 'The language model is off, so this cannot be translated.', transFail: 'Could not finish the translation', transSkipped: 'Some parts could not be translated and remain in the original.', retry: 'Retry',
      badge: 'News', open: 'Open original article', loading: 'Loading article text', close: 'Close',
      partial: 'Only the summary could be loaded. Read the full story at the original link.',
      fail: 'Could not load this article. Use the original link above.',
      note: 'The text below is the original article, unchanged (not translated or summarized).',
    },
    co: {
      unlisted: 'Private company', unlistedNote: 'Not publicly traded, so there is no price or chart. News and the AI briefing are available.',
      back: '← Back', news: 'Related news', briefing: 'AI briefing', toggle: 'AI briefing', generate: 'Generate briefing', regenerate: 'Regenerate',
      writing: 'Agent is writing this company briefing (1-2 min)', waitingNet: 'Paused: no internet — resumes automatically when back online', noBriefing: 'No briefing for this company yet.',
      offline: 'No model connected, so no briefing can be generated.', generated: 'Generated', holding: 'In portfolio', qty: 'Qty', range52: '52-week range', last: 'As of',
      addToPortfolio: '+ Add to portfolio', inPortfolio: 'My portfolio', noNews: 'No news about this company in the last 3 days.', newsWorking: 'Agent is translating and summarizing the news', chart: 'Price',
    },
    eco: { addPlaceholder: 'Indicator to add (e.g. Germany unemployment)', add: 'Ask the agent', ask: (q) => `Add this to my macro indicators: ${q}` },
    pe: {
      labelHint: 'e.g. Shipbuilding, Defense, Batteries', autofill: 'Auto-fill', filling: 'Agent is filling in', fillFail: 'Auto-fill failed — enter manually',
      title: 'Edit portfolio', edit: 'Edit', holdings: 'Holdings', industries: 'Industries', symbol: 'Ticker', name: 'Name', nameEn: 'English name', industry: 'Industry', qty: 'Qty',
      add: '+ Add holding', remove: 'Remove', addIndustry: '+ Add industry', label: 'Industry name', labelEn: 'English name', benchmark: 'Benchmark (ticker)',
      kwEn: 'English news keywords (comma-separated)', kwKo: 'Korean news keywords (comma-separated)', save: 'Save', cancel: 'Cancel', saving: 'Saving', saved: 'Saved',
      qtyHint: 'Fill every quantity to see value and weights (leave empty for equal weights)', find: 'Find by name or ticker', empty: 'No holdings yet. Add one below.',
      industryHint: 'Type just the industry name and the agent fills in the English name, benchmark and news keywords. Pick an industry per holding to group its news, performance and map.', confirmLeave: 'You have unsaved changes. Close anyway?',
    },
    pf: { holdings: 'holdings', range: 'Chart range', mode: 'View', grid: 'Grid', rows: 'Rows' },
    banner: 'You are viewing the example portfolio. Press "Edit" on the portfolio panel to enter your holdings.',
    offline: 'No internet connection — showing the last data received; background jobs resume when back online.',
    llmOn: '● AGENT',
    llmOff: '○ AGENT offline',
    llmAuth: '○ AGENT key error',
    setup: {
      title: 'Macro Terminal setup', intro: 'Choose a language and a model to begin. Indicators, markets and original news work without a model. You can change all of this later on this page (/setup).',
      language: 'Language', preset: 'Starting configuration', presetGlobal: 'Global (world markets, US stock example)', presetKorea: 'Korea (Korean markets, Korean stock example)', presetNote: 'Macro indicators start with the US. Ask the agent for other countries and it finds and adds them. Changing this replaces the market list; your portfolio changes too only while it is still the example.',
      currency: 'Base currency', currencyNote: 'Value and P&L are converted to this currency. Do not change it once you have trade records (their FX rates are in this currency).',
      llm: 'Model connection', kind: 'Type', baseUrl: 'Server URL', model: 'Model', modelHint: 'Test the connection to pick from the server’s model list', apiKey: 'API key', apiKeyKept: 'Keeping the saved key (type to replace)', apiKeyEnv: 'Using LLM_API_KEY from .env',
      test: 'Test connection', testing: 'Testing', testChat: 'Answer', testJson: 'Structured output', testTools: 'Tool calling', testOffline: 'Could not reach the server', testAuth: 'The API key was rejected',
      privacy: 'This URL is a service outside this computer. Your portfolio, trade notes, chats and their emotion analysis are sent to this provider, and each call may cost money.',
      background: 'Call the model automatically', backgroundNote: 'Runs news translation and summaries, map tagging, company description translation and startup briefings without you pressing anything. Off by default for remote APIs because it can cost money without you noticing.',
      ecos: 'Bank of Korea ECOS key (optional)', save: 'Save and start', saving: 'Saving', needModel: 'Enter a model name',
      kinds: { ollama: 'Ollama (local)', llamacpp: 'llama.cpp (local)', lmstudio: 'LM Studio (local)', openai: 'OpenAI', anthropic: 'Anthropic (Claude)', gemini: 'Google Gemini', openrouter: 'OpenRouter', custom: 'Custom (OpenAI-compatible)' },
    },
    search: {
      searching: 'Searching',
      none: 'No results — try another name or a ticker',
      via: (q) => `Agent resolved: “${q}”`,
      unverified: 'Korean name unverified', unverifiedHint: 'No Korean name found in KRX, Wikidata or Korean news, so the English name is shown',
      kinds: { fn: 'Screen', macro: 'Indicator', market: 'Market', holding: 'Holding', stock: 'Stock', index: 'Index', topic: 'News', entity: 'Private' },
    },
  },
};

/** 해당 언어 문구. 언어 묶음이 번역하지 않은 항목은 영어로 채운다 */
export function stringsFor(lang: Lang): Strings {
  if (lang === 'ko' || lang === 'en') return STRINGS[lang];
  const pack = LOCALE_PACKS.find((p) => p.code === lang);
  return deepMerge(STRINGS.en, { locale: pack?.locale, ...pack?.strings });
}
