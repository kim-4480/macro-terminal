import { baseLang } from '@/shared/languages';
import { ActionError } from './action-error';
import type { AgentAction, AgentDecision, Lang } from '@/shared/types';
import { cleanCompanyName, resolveNames, SYMBOL_RE } from './company';
import { loadConfig, type MacroItem, type Portfolio, savePortfolio, type Settings } from './config';
import { addMacroItem, INDICATOR_ID_HELP, prepareIndicator, removeMacroItem } from './indicators';
import { suggestIndustry } from './industry-suggest';
import { namesMatch } from './name-resolver';
import { koNameByTicker } from './sources/wikidata';
import type { ToolSpec } from './llm';
import { quote } from './market-data';
import { norm } from './text-match';

// 에이전트가 터미널 안에서 바꿀 수 있는 것(샌드박스): 포트폴리오 종목·업계와 거시 지표 목록뿐.
// 셸·파일 도구는 없고, 웹은 공개 주소를 읽기만 한다. 바꾸는 작업은 모두
//   1) 여기서 검사해 승인 카드(AgentAction)를 만들고 → 2) 사용자가 승인하면 → 3) 실행
// 순서로 진행한다. 실행할 내용은 서버가 들고 있고, 화면에서는 수량·업계만 고칠 수 있다.

export const ACTION_TOOLS: ToolSpec[] = [
  {
    name: 'add_holding',
    description: 'Add a stock to the user\'s portfolio (asks the user to approve first). Use a ticker returned by search_symbols. qty defaults to 1. industry: an industry id or name from the portfolio; omit if unsure (the user picks).',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, qty: { type: 'number' }, industry: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'update_holding',
    description: 'Change the quantity or industry of a stock already in the portfolio (asks the user to approve first).',
    parameters: { type: 'object', properties: { symbol: { type: 'string' }, qty: { type: 'number' }, industry: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'remove_holding',
    description: 'Remove a stock from the portfolio (asks the user to approve first).',
    parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'add_industry',
    description: 'Add a new industry group to the portfolio by name, e.g. "데이터 센터" (asks the user to approve first). English name, benchmark ETF and news queries are filled in automatically.',
    parameters: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
  },
  {
    name: 'add_indicator',
    description: `Add a data series to the user's macro indicators (asks the user to approve first; the card shows the real latest value). Find the series yourself with web_search and read_web_page, and confirm it with test_indicator first. ${INDICATOR_ID_HELP} label: name in the user's language. labelEn: English name. group: country or region name in the user's language; reuse a group from [S0] if it fits. groupEn: the group in English. unit: "%", "%p" for a spread, or empty. transform: "yoy" if the series is an index level and should be shown as a year-over-year change.`,
    parameters: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, labelEn: { type: 'string' }, group: { type: 'string' }, groupEn: { type: 'string' }, unit: { type: 'string' }, transform: { type: 'string', enum: ['yoy'] } }, required: ['id', 'label', 'group'] },
  },
  {
    name: 'remove_indicator',
    description: 'Remove a series from the user\'s macro indicators by its id from list_indicators (asks the user to approve first).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export const isActionTool = (name: string): boolean => ACTION_TOOLS.some((t) => t.name === name);

/** 승인 전까지 서버가 들고 있는 실행 내용 */
export type ActionPlan =
  | { kind: 'add_holding'; symbol: string; name: string; nameEn: string; qty: number; industry: string | null }
  | { kind: 'update_holding'; symbol: string; name: string; qty: number | null; industry: string | null }
  | { kind: 'remove_holding'; symbol: string; name: string }
  | { kind: 'add_industry'; industry: Portfolio['industries'][number] }
  | { kind: 'add_indicator'; item: MacroItem }
  | { kind: 'remove_indicator'; id: string; label: string };

export { ActionError };

const T = {
  ko: { qty: '수량', industry: '업계', ticker: '티커', name: '이름', unset: '(선택 필요)', bench: '대표 지표', kw: '뉴스 검색어', shares: (n: number) => `${n}주` },
  en: { qty: 'Quantity', industry: 'Industry', ticker: 'Ticker', name: 'Name', unset: '(choose)', bench: 'Benchmark', kw: 'News queries', shares: (n: number) => `${n} sh` },
};

/** 업계 id·한국어·영어 이름 중 맞는 것 */
export function findIndustry(portfolio: Portfolio, raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const q = norm(raw);
  const hit = portfolio.industries.find((i) => norm(i.id) === q || norm(i.label) === q || norm(i.labelEn ?? '') === q)
    ?? portfolio.industries.find((i) => [i.label, i.labelEn ?? ''].some((l) => l && (norm(l).includes(q) || q.includes(norm(l)))));
  return hit?.id ?? null;
}

const validQty = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e9 ? v : null);

const industryLabel = (p: Portfolio, id: string | null, lang: Lang) => {
  const ind = id ? p.industries.find((i) => i.id === id) : null;
  return ind ? (lang !== 'ko' ? ind.labelEn ?? ind.label : ind.label) : T[baseLang(lang)].unset;
};

function makeId(base: string, taken: Set<string>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'industry';
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
  return id;
}

/** 도구 호출 → 검사 → 승인 카드와 실행 내용 */
export async function prepareAction(name: string, args: Record<string, unknown>, settings: Settings, lang: Lang): Promise<{ action: Omit<AgentAction, 'id'>; plan: ActionPlan }> {
  const { portfolio } = loadConfig();
  if (name === 'add_indicator' || name === 'remove_indicator') return prepareIndicator(name, args, settings, lang);
  const t = T[baseLang(lang)];
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string).trim() : '');
  const industries = portfolio.industries.map((i) => ({ id: i.id, label: lang !== 'ko' ? i.labelEn ?? i.label : i.label }));

  if (name === 'add_industry') {
    const label = str('label').slice(0, 40);
    if (!label) throw new ActionError('label 이 필요합니다');
    if (findIndustry(portfolio, label) && portfolio.industries.some((i) => norm(i.label) === norm(label))) throw new ActionError(`이미 있는 업계입니다: ${label}`);
    const s = await suggestIndustry(settings, label);
    const industry = { id: makeId(s.labelEn, new Set(portfolio.industries.map((i) => i.id))), label, labelEn: s.labelEn, en: s.en, ko: s.ko, ...(s.benchmark ? { benchmark: s.benchmark } : {}) };
    return {
      plan: { kind: 'add_industry', industry },
      action: {
        kind: 'add_industry',
        title: lang === 'ko' ? `업계 추가: ${label} (${s.labelEn})` : `Add industry: ${label} (${s.labelEn})`,
        detail: [{ label: t.bench, value: s.benchmark ?? '—' }, { label: t.kw, value: [...s.en, ...s.ko].join(', ') }],
      },
    };
  }

  const symbol = str('symbol').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new ActionError('잘못된 티커입니다. search_symbols 로 먼저 찾으세요');
  const held = portfolio.holdings.find((h) => h.symbol === symbol);

  if (name === 'add_holding') {
    if (held) throw new ActionError(`${symbol} 은 이미 포트폴리오에 있습니다. 수량을 바꾸려면 update_holding`);
    // 티커가 실제로 있는지 Yahoo로 확인(모델이 지어낸 티커를 막는다)
    const q = await quote(symbol).catch(() => null);
    if (!q?.points.length) throw new ActionError(`${symbol}: 시세를 찾을 수 없는 티커입니다. search_symbols 결과의 티커를 쓰세요`);
    const names = await resolveNames({ kind: 'listed', symbol, hint: null }, portfolio);
    const nameEn = cleanCompanyName(cleanCompanyName(names.nameEn || q.name)) || symbol;
    // 한국어 이름이 없으면 위키데이터에서 확인(에이전트가 이름을 지어내지 않게)
    if (!/[가-힣]/.test(names.nameKo)) {
      const wiki = await koNameByTicker(symbol, (en) => namesMatch(nameEn, en)).catch(() => null);
      names.nameKo = wiki?.label ?? nameEn;
    }
    const qty = validQty(args.qty) ?? 1;
    const industry = findIndustry(portfolio, str('industry'));
    return {
      plan: { kind: 'add_holding', symbol, name: names.nameKo || nameEn, nameEn, qty, industry },
      action: {
        kind: 'add_holding',
        title: lang === 'ko' ? `${names.nameKo || nameEn} (${symbol}) 포트폴리오에 추가` : `Add ${nameEn} (${symbol}) to the portfolio`,
        detail: [{ label: t.name, value: names.nameKo && names.nameKo !== nameEn ? `${names.nameKo} / ${nameEn}` : nameEn }, { label: t.ticker, value: symbol }],
        qty, industry, industries,
      },
    };
  }

  if (!held) throw new ActionError(`${symbol} 은 포트폴리오에 없습니다`);
  const name0 = held.name ?? held.nameEn ?? symbol;
  if (name === 'update_holding') {
    const qty = validQty(args.qty);
    const industry = findIndustry(portfolio, str('industry'));
    if (qty == null && !industry) throw new ActionError('바꿀 qty 또는 industry 가 필요합니다');
    return {
      plan: { kind: 'update_holding', symbol, name: name0, qty, industry },
      action: {
        kind: 'update_holding',
        title: lang === 'ko' ? `${name0} (${symbol}) 수정` : `Update ${name0} (${symbol})`,
        detail: [
          ...(qty != null ? [{ label: t.qty, value: `${held.qty ?? '—'} → ${qty}` }] : []),
          ...(industry ? [{ label: t.industry, value: `${industryLabel(portfolio, held.industry, lang)} → ${industryLabel(portfolio, industry, lang)}` }] : []),
        ],
        qty: qty ?? held.qty ?? null, industry: industry ?? held.industry, industries,
      },
    };
  }
  if (name === 'remove_holding') {
    return {
      plan: { kind: 'remove_holding', symbol, name: name0 },
      action: { kind: 'remove_holding', title: lang === 'ko' ? `${name0} (${symbol}) 포트폴리오에서 삭제` : `Remove ${name0} (${symbol}) from the portfolio`, detail: [{ label: t.qty, value: String(held.qty ?? '—') }] },
    };
  }
  throw new ActionError(`unknown action ${name}`);
}

/** 승인된 작업 실행(그 순간의 파일을 다시 읽어 바꾼다). 결과 문장을 돌려준다. */
export function executeAction(plan: ActionPlan, decision: AgentDecision, lang: Lang): string {
  const { portfolio } = loadConfig();
  const qty = validQty(decision.qty);
  const pickIndustry = (fallback: string | null) => (decision.industry && portfolio.industries.some((i) => i.id === decision.industry) ? decision.industry : fallback);
  const ko = lang === 'ko';

  switch (plan.kind) {
    case 'add_holding': {
      const industry = pickIndustry(plan.industry);
      if (!industry) throw new ActionError(ko ? '업계를 골라야 추가할 수 있습니다' : 'An industry is required');
      if (portfolio.holdings.some((h) => h.symbol === plan.symbol)) throw new ActionError(`${plan.symbol} 은 이미 있습니다`);
      const n = qty ?? plan.qty;
      savePortfolio({ ...portfolio, example: false, holdings: [...portfolio.holdings, { symbol: plan.symbol, name: plan.name, nameEn: plan.nameEn, industry, qty: n }] });
      return ko ? `${plan.name} (${plan.symbol}) ${n}주를 ${industryLabel(portfolio, industry, lang)} 업계에 추가했다.` : `Added ${n} shares of ${plan.nameEn} (${plan.symbol}) to ${industryLabel(portfolio, industry, lang)}.`;
    }
    case 'update_holding': {
      const industry = pickIndustry(plan.industry);
      const n = qty ?? plan.qty;
      const holdings = portfolio.holdings.map((h) => (h.symbol === plan.symbol ? { ...h, ...(n != null ? { qty: n } : {}), ...(industry ? { industry } : {}) } : h));
      if (!portfolio.holdings.some((h) => h.symbol === plan.symbol)) throw new ActionError(`${plan.symbol} 이 포트폴리오에 없습니다`);
      savePortfolio({ ...portfolio, example: false, holdings });
      return ko ? `${plan.name} (${plan.symbol})을 수정했다${n != null ? ` — 수량 ${n}` : ''}${industry ? ` — 업계 ${industryLabel(portfolio, industry, lang)}` : ''}.` : `Updated ${plan.name} (${plan.symbol}).`;
    }
    case 'remove_holding': {
      savePortfolio({ ...portfolio, example: false, holdings: portfolio.holdings.filter((h) => h.symbol !== plan.symbol) });
      return ko ? `${plan.name} (${plan.symbol})을 포트폴리오에서 삭제했다.` : `Removed ${plan.name} (${plan.symbol}) from the portfolio.`;
    }
    case 'add_indicator':
      addMacroItem(plan.item);
      return ko ? `거시 지표 ${plan.item.label}(${plan.item.id})를 ${plan.item.group} 그룹에 추가했다.` : `Added macro indicator ${plan.item.labelEn ?? plan.item.label} (${plan.item.id}) to ${plan.item.groupEn ?? plan.item.group}.`;
    case 'remove_indicator':
      removeMacroItem(plan.id);
      return ko ? `거시 지표 ${plan.label}를 삭제했다.` : `Removed macro indicator ${plan.label}.`;
    case 'add_industry': {
      const ids = new Set(portfolio.industries.map((i) => i.id));
      const industry = { ...plan.industry, id: ids.has(plan.industry.id) ? makeId(plan.industry.id, ids) : plan.industry.id };
      savePortfolio({ ...portfolio, example: false, industries: [...portfolio.industries, industry] });
      return ko ? `업계 ${industry.label}(${industry.labelEn})를 추가했다. id: ${industry.id}` : `Added industry ${industry.labelEn} (id: ${industry.id}).`;
    }
  }
}
