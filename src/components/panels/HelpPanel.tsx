'use client';

import { baseLang } from '@/shared/languages';
import { useLang } from '@/lib/i18n';
import { Panel } from '../ui';

const ROWS = {
  ko: [
    ['HOME', '전체 대시보드'],
    ['ECO', '거시경제 지표 — 미국이 기본 (FRED 등) · 다른 나라 지표는 에이전트에게 요청'],
    ['MKT', '지수·환율·원자재·코인'],
    ['GC', '미국 국채 금리 곡선 (현재·1개월 전·1년 전)'],
    ['PORT', '보유 종목과 업계별 성과'],
    ['N', '업계·거시 뉴스 (모델 번역·요약)'],
    ['BRIEF', '모델이 쓴 종합 브리핑'],
    ['MAP', '뉴스가 일어난 곳을 세계지도로'],
    ['AI', '전체 화면 AI 에이전트 — 질문과 작업(종목 추가·브리핑 등). 오른쪽 위 AI 버튼은 옆 창'],
    ['HELP', '이 도움말(명령창에 HELP)'],
  ],
  en: [
    ['HOME', 'Full dashboard'],
    ['ECO', 'Macro indicators — US by default (FRED and others) · ask the agent to add other countries'],
    ['MKT', 'Indices, FX, commodities, crypto'],
    ['GC', 'US Treasury yield curve (now, 1M ago, 1Y ago)'],
    ['PORT', 'Holdings and performance by industry'],
    ['N', 'Industry and macro news (translated and summarized by your model)'],
    ['BRIEF', 'Daily briefing written by your model'],
    ['MAP', 'Where the news is happening, on a world map'],
    ['AI', 'Full-screen AI agent — questions and tasks (add stocks, briefings…). The AI button opens it as a side panel'],
    ['HELP', 'This help (type HELP in the command bar)'],
  ],
} as const;

export function HelpPanel() {
  const { lang } = useLang();
  const ko = lang === 'ko';
  return (
    <Panel code="HELP" className="help">
      <p>
        {ko
          ? '명령창에 화면 코드, 종목명(한국어·영어), 티커, 지표 이름을 입력하세요. 목록에서 ↑↓로 고르고 Enter. Esc는 홈으로, 아무 곳에서나 글자를 치면 명령창으로 이동합니다.'
          : 'Type a screen code, a company name (English or Korean), a ticker or an indicator. Pick with ↑↓ and press Enter. Esc goes home; typing anywhere jumps to the command bar.'}
      </p>
      <table className="t">
        <tbody>
          {ROWS[baseLang(lang)].map(([code, text]) => <tr key={code}><td className="code">{code}</td><td>{text}</td></tr>)}
          <tr>
            <td className="code">{ko ? '검색' : 'Search'}</td>
            <td>{(ko ? ['삼성전자', '에스케이하이닉스', '엔비디아', 'NVDA', '실업률', '반도체'] : ['NVDA', 'Samsung', 'SK hynix', 'unemployment', 'semiconductor']).map((s) => <code key={s} style={{ marginRight: 8 }}>{s}</code>)}</td>
          </tr>
        </tbody>
      </table>
      <p className="dim">
        {ko
          ? '국내 종목은 KRX 상장사 목록, 해외 종목은 Yahoo 검색을 씁니다. 한국어로 찾은 해외 종목은 모델이 영어 이름으로 바꿔 검색합니다. 행을 클릭하면 상세 차트와 기업 개요(yfinance)가 열립니다.'
          : 'Korean stocks come from the KRX listing, others from Yahoo search. Korean-language queries for foreign stocks are converted to English by your model. Click a row for its chart and company profile (yfinance).'}
      </p>
    </Panel>
  );
}
