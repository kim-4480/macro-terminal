'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { LangSwitch } from './LangSwitch';
import { useLang } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { useChat } from '@/lib/useChat';
import { type AgentScreen, type AgentUi, NAV_CODES, VIEW_CODES, type ChartTarget, type NewsItem, type StatusResponse, type ViewCode } from '@/shared/types';
import { ActionsContext, type TerminalActions } from './actions';
import { ArticleReader } from './ArticleReader';
import { ChartModal } from './ChartModal';
import { Chat, ChatSidebar } from './Chat';
import { CommandBar, type CommandBarHandle } from './CommandBar';
import { CompanyPage } from './CompanyPage';
import { BriefingPanel } from './panels/BriefingPanel';
import { CurvePanel } from './panels/CurvePanel';
import { EcoPanel } from './panels/EcoPanel';
import { HelpPanel } from './panels/HelpPanel';
import { MapPanel } from './panels/MapPanel';
import { MarketPanel } from './panels/MarketPanel';
import { NewsPanel } from './panels/NewsPanel';
import { PortfolioPanel } from './panels/PortfolioPanel';
import { PortfolioEditor, type PortfolioPrefill } from './PortfolioEditor';
import { PortfolioPage } from './PortfolioPage';
import { TickerStrip } from './TickerStrip';

const viewFromHash = (): ViewCode => {
  const h = window.location.hash.slice(1) as ViewCode;
  return VIEW_CODES.includes(h) ? h : 'HOME';
};

interface CompanyTarget {
  /** 상장사 티커 */
  symbol: string | null;
  /** 비상장 기업 영어 이름 */
  entity: string | null;
  hint: string | null;
  /** 돌아갈 화면 */
  from: ViewCode;
}

// 회사 페이지 주소: #CO=005930.KS (상장) / #ENT=ChangXin%20Memory (비상장)
function companyFromHash(): CompanyTarget | null {
  const h = window.location.hash;
  const co = h.match(/^#CO=([A-Za-z0-9.^=%-]{1,40})$/);
  if (co?.[1]) return { symbol: decodeURIComponent(co[1]), entity: null, hint: null, from: 'HOME' };
  const ent = h.match(/^#ENT=(.{2,200})$/);
  if (ent?.[1]) return { symbol: null, entity: decodeURIComponent(ent[1]), hint: null, from: 'HOME' };
  return null;
}

const sameCompany = (a: CompanyTarget | null, b: CompanyTarget | null) => !!a && !!b && a.symbol === b.symbol && a.entity === b.entity;

export function Terminal() {
  const { T, lang, setLang } = useLang();
  const [view, setViewState] = useState<ViewCode>('HOME');
  const [chart, setChart] = useState<ChartTarget | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPending, setChatPending] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyTarget | null>(null);
  const [editor, setEditor] = useState<{ prefill: PortfolioPrefill | null } | null>(null);
  const [article, setArticle] = useState<NewsItem | null>(null);
  const cmd = useRef<CommandBarHandle>(null);
  // 전체 화면 에이전트(AI)에서 돌아갈 화면
  const beforeAi = useRef<ViewCode>('HOME');
  const { data: status } = useApi<StatusResponse>('/api/status', { refreshInterval: 20_000 });

  // 주소의 #ECO 같은 해시와 화면을 맞춘다
  useEffect(() => {
    setViewState(viewFromHash());
    setCompany(companyFromHash());
    setTopic(storage.get('topic'));
    const onHash = () => {
      const next = companyFromHash();
      if (next) setCompany((c) => (sameCompany(c, next) ? c : next));
      else { setCompany(null); setViewState(viewFromHash()); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setView = useCallback((v: ViewCode) => {
    setCompany(null);
    setViewState((cur) => { if (v === 'AI' && cur !== 'AI') beforeAi.current = cur; return v; });
    if (v === 'AI') setChatOpen(false); // 전체 화면이 옆 창을 대신한다
    history.replaceState(null, '', v === 'HOME' ? window.location.pathname : `#${v}`);
  }, []);

  const openCompany = useCallback((symbol: string, hint?: string) => {
    setChart(null);
    setCompany({ symbol, entity: null, hint: hint ?? null, from: viewFromHash() });
    history.replaceState(null, '', `#CO=${encodeURIComponent(symbol)}`);
    window.scrollTo({ top: 0 });
  }, []);

  const openEntity = useCallback((nameEn: string, hint?: string) => {
    setChart(null);
    setCompany({ symbol: null, entity: nameEn, hint: hint ?? null, from: viewFromHash() });
    history.replaceState(null, '', `#ENT=${encodeURIComponent(nameEn)}`);
    window.scrollTo({ top: 0 });
  }, []);

  const fullChat = !company && view === 'AI';

  /** 옆 창 ↔ 전체 화면 */
  const toggleChatMode = useCallback(() => {
    if (view === 'AI') { setView(beforeAi.current === 'AI' ? 'HOME' : beforeAi.current); setChatOpen(true); }
    else setView('AI');
  }, [view, setView]);

  // 에이전트가 화면을 열면: 전체 화면이었으면 옆 창으로 바꿔 대화를 계속 보이게 한다
  const onAgentUi = useCallback((ui: AgentUi) => {
    if (fullChat) setChatOpen(true);
    if (ui.kind === 'company') openCompany(ui.symbol, ui.name);
    else setView(ui.code);
  }, [fullChat, openCompany, setView]);

  // 에이전트에 알릴 지금 화면(회사 페이지면 그 티커·이름)
  const screen: AgentScreen = { view: company ? company.from : view, company: company ? company.symbol ?? company.entity : null, drawer: chatOpen && !fullChat };
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const getScreen = useCallback(() => screenRef.current, []);

  const chat = useChat({ lang, messages: T.chat, onUi: onAgentUi, getScreen });

  const actions = useMemo<TerminalActions>(() => ({
    openChart: setChart,
    setView,
    selectTopic: (id) => { storage.set('topic', id); setTopic(id); },
    openChat: (question) => { if (question?.trim()) setChatPending(question.trim()); if (viewFromHash() !== 'AI') setChatOpen(true); },
    openCompany,
    openEntity,
    openArticle: setArticle,
    openPortfolioEditor: (prefill) => setEditor({ prefill: prefill ?? null }),
  }), [setView, openCompany, openEntity]);

  // Esc = 홈/차트 닫기, 아무 곳에서나 글자를 치면 명령창으로(한글 IME 조합이 깨지지 않게 기본 동작은 그대로)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (e.key === 'Escape' && !typing) {
        if (editor) return; // 편집기는 자체 닫기(저장 안 한 변경 확인)
        if (article) setArticle(null);
        else if (chart) setChart(null);
        else if (chatOpen) setChatOpen(false);
        else if (company) setView(company.from);
        else setView('HOME');
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || chart || editor || article || fullChat) return;
      if ((e.key.length === 1 && e.key !== ' ') || e.key === 'Process') cmd.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [article, chart, chatOpen, company, editor, fullChat, setView]);

  const llm = status?.llm;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app" data-view={company ? 'CO' : view} data-drawer={chatOpen && !fullChat ? '' : undefined}>
        <header className="top" hidden={fullChat}>
          <div className="brand"><b>MACRO</b><span>TERMINAL</span></div>
          <CommandBar ref={cmd} />
          <div className="status">
            <button type="button" className={`ai-btn${chatOpen || fullChat ? ' active' : ''}`} onClick={() => (fullChat ? toggleChatMode() : setChatOpen((o) => !o))} aria-pressed={chatOpen || fullChat}>
              <b>AI</b>{T.chat.open}
            </button>
            <LangSwitch />
            <a href="/setup" className={`pill ${llm ? (llm.online ? 'on' : 'off') : ''}`} title={`${llm?.model ?? ''} · ${llm?.baseUrl ?? ''}`}>
              {llm ? (llm.online ? T.llmOn : llm.reason === 'auth' ? T.llmAuth : T.llmOff) : 'AGENT …'}
            </a>
            <Clock locale={T.locale} />
          </div>
        </header>

        {fullChat ? null : <TickerStrip />}

        <nav className="fn-bar" hidden={fullChat}>
          {NAV_CODES.map((c) => (
            <button key={c} className={!company && c === view ? 'active' : ''} aria-pressed={!company && c === view} onClick={() => setView(c)}>
              <b>{c}</b>{T.views[c]}
            </button>
          ))}
        </nav>

        {status?.configError ? <div className="banner err-banner">{status.configError}</div> : null}
        {status && !status.internet ? <div className="banner">{T.offline}</div> : null}
        {status?.example && !fullChat ? <div className="banner">{T.banner}</div> : null}

        {company ? (
          <CompanyPage
            key={company.symbol ?? company.entity ?? ''}
            symbol={company.symbol}
            entity={company.entity}
            hint={company.hint}
            onBack={() => setView(company.from)}
            onAddToPortfolio={(symbol, name, nameEn) => setEditor({ prefill: { symbol, name, nameEn } })}
          />
        ) : null}

        {!company && view === 'PORT' ? <PortfolioPage /> : null}

        {fullChat ? (
          <div className="ai-shell">
            <ChatSidebar chat={chat} onView={setView} />
            <Chat
              chat={chat}
              mode="full"
              pending={chatPending}
              onPendingSent={() => setChatPending(null)}
              onToggleMode={toggleChatMode}
              llmOnline={llm?.online}
            />
          </div>
        ) : null}

        <main className="grid" hidden={!!company || view === 'PORT' || view === 'AI'}>
          <EcoPanel />
          <MarketPanel />
          <CurvePanel />
          <PortfolioPanel />
          <NewsPanel topicId={topic} onSelectTopic={actions.selectTopic} />
          <BriefingPanel />
          {view === 'MAP' ? <MapPanel /> : null}
          {view === 'HELP' ? <HelpPanel /> : null}
        </main>

        <Chat
          chat={chat}
          mode="drawer"
          open={chatOpen && !fullChat}
          pending={fullChat ? null : chatPending}
          onPendingSent={() => setChatPending(null)}
          onClose={() => setChatOpen(false)}
          onToggleMode={toggleChatMode}
          llmOnline={llm?.online}
        />

        {editor ? <PortfolioEditor prefill={editor.prefill} onClose={() => setEditor(null)} /> : null}

        {article ? <ArticleReader key={article.link} item={article} onClose={() => setArticle(null)} /> : null}

        {chart ? <ChartModal key={`${chart.id}:${lang}`} target={chart} onClose={() => setChart(null)} /> : null}
      </div>
    </ActionsContext.Provider>
  );
}

function Clock({ locale }: { locale: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="clock" />;
  const f = (tz: string | undefined) => now.toLocaleTimeString(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <span className="clock">
      <span>LOCAL <b>{f(undefined)}</b></span>
      <span>NEW YORK <b>{f('America/New_York')}</b></span>
    </span>
  );
}
