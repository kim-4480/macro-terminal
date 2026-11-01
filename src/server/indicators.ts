import { baseLang } from '@/shared/languages';
import type { AgentAction, Lang, Point } from '@/shared/types';
import type { ActionPlan } from './agent-actions';
import { ActionError } from './action-error';
import { type MacroItem, rawSettings, saveSettings, type Settings } from './config';
import { parseSeriesId, rawSeries } from './market-data';
import { safeFetchText } from './sources/article';
import { yoy } from './util';

// 거시 지표 추가. 서버에는 나라별 경로 목록을 두지 않는다: 연결된 모델이 경로를 찾고,
// 서버는 그 경로에서 데이터를 실제로 받아 보여 주고, 사용자가 승인하면 설정에 넣는다.

/** 도구 설명에 넣는 경로 형식. 나라·통계별 경로가 아니라 데이터 소스별 읽는 방법이다 */
export const INDICATOR_ID_HELP = 'id formats: fred:<series id from fred.stlouisfed.org/series/<ID>>; imf:<dataset>/<SDMX series key>, for example imf:CPI/<ISO3 country>.CPI._T.YOY_PCH_PA_PT.M; ecos:<stat code>/<cycle>/<item code> (Bank of Korea, needs a key); yahoo:<ticker>; csv:<public https CSV URL>#date=<date column>&value=<value column>&where=<column>:<value> (where is optional, for files mixing countries).';

export interface IndicatorProbe {
  id: string;
  /** 소스가 알려 준 시계열 이름(모를 수 있다) */
  title: string | null;
  observations: number;
  observationsPerYear: number;
  firstDate: string;
  lastDate: string;
  latest: Point[];
}

/** FRED 시계열 페이지의 제목. 받지 못해도 지표 확인은 계속한다 */
async function sourceTitle(id: string): Promise<string | null> {
  const { src, key } = parseSeriesId(id);
  if (src !== 'fred') return null;
  try {
    const { body } = await safeFetchText(`https://fred.stlouisfed.org/series/${encodeURIComponent(key)}`);
    return body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s*\|\s*FRED.*$/s, '').trim() ?? null;
  } catch {
    return null;
  }
}

export function summarizeSeries(id: string, points: Point[], title: string | null): IndicatorProbe {
  if (!points.length) throw new Error(`${id}: 데이터가 없습니다`);
  const lastYear = points.slice(-1)[0]![0].slice(0, 4);
  const recent = points.filter((p) => p[0].slice(0, 4) === String(Number(lastYear) - 1)).length;
  return {
    id,
    title,
    observations: points.length,
    observationsPerYear: recent,
    firstDate: points[0]![0],
    lastDate: points.at(-1)![0],
    latest: points.slice(-6),
  };
}

export async function probeIndicator(id: string, settings: Settings, transform?: 'yoy'): Promise<IndicatorProbe> {
  if (!/^(fred|ecos|imf|yahoo|csv):.+/.test(id)) throw new Error(`경로 형식이 틀렸습니다: ${id}`);
  const [points, title] = await Promise.all([rawSeries(id, settings), sourceTitle(id)]);
  return summarizeSeries(id, transform === 'yoy' ? yoy(points) : points, title);
}

const CARD = {
  ko: { name: '이름', group: '그룹', path: '경로', source: '소스 제목', latest: '최신 값', range: '기간', add: (l: string) => `거시 지표 추가: ${l}`, remove: (l: string) => `거시 지표 삭제: ${l}` },
  en: { name: 'Name', group: 'Group', path: 'Path', source: 'Source title', latest: 'Latest value', range: 'Range', add: (l: string) => `Add macro indicator: ${l}`, remove: (l: string) => `Remove macro indicator: ${l}` },
};

/** 승인 카드 만들기. 경로에서 실제로 받은 값을 카드에 보여 주어 사용자가 내용을 확인하게 한다 */
export async function prepareIndicator(name: string, args: Record<string, unknown>, settings: Settings, lang: Lang): Promise<{ action: Omit<AgentAction, 'id'>; plan: ActionPlan }> {
  const str = (k: string, max: number) => (typeof args[k] === 'string' ? (args[k] as string).trim().slice(0, max) : '');
  const t = CARD[baseLang(lang)];
  const id = str('id', 1000);
  if (!id) throw new ActionError('id 가 필요합니다');

  if (name === 'remove_indicator') {
    const item = settings.macro.find((m) => m.id === id);
    if (!item) throw new ActionError(`지표 목록에 없습니다: ${id}`);
    const label = lang === 'ko' ? item.label : item.labelEn ?? item.label;
    return {
      plan: { kind: 'remove_indicator', id, label },
      action: { kind: 'remove_indicator', title: t.remove(label), detail: [{ label: t.path, value: id }] },
    };
  }

  if (settings.macro.some((m) => m.id === id)) throw new ActionError(`이미 있는 지표입니다: ${id}`);
  const label = str('label', 60);
  const group = str('group', 40);
  if (!label || !group) throw new ActionError('label 과 group 이 필요합니다');
  const transform = args.transform === 'yoy' ? 'yoy' as const : undefined;
  const probe = await probeIndicator(id, settings, transform);
  const [date, value] = probe.latest.at(-1)!;
  const unit = str('unit', 8);
  const shownLabel = lang === 'ko' ? label : str('labelEn', 60) || label;
  const item: MacroItem = {
    group, id, label, unit,
    ...(str('groupEn', 40) ? { groupEn: str('groupEn', 40) } : {}),
    ...(str('labelEn', 60) ? { labelEn: str('labelEn', 60) } : {}),
    ...(transform ? { transform } : {}),
  };
  return {
    plan: { kind: 'add_indicator', item },
    action: {
      kind: 'add_indicator',
      title: t.add(shownLabel),
      detail: [
        { label: t.group, value: lang === 'ko' ? group : str('groupEn', 40) || group },
        { label: t.path, value: id },
        ...(probe.title ? [{ label: t.source, value: probe.title }] : []),
        { label: t.latest, value: `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}${unit} (${date})` },
        { label: t.range, value: `${probe.firstDate} ~ ${probe.lastDate}` },
      ],
    },
  };
}

/** 같은 그룹 지표 뒤에 넣는다(화면이 이어진 행을 한 그룹으로 묶는다) */
export function insertMacroItem(macro: MacroItem[], item: MacroItem): MacroItem[] {
  const at = macro.map((m) => m.group).lastIndexOf(item.group);
  return at < 0 ? [...macro, item] : [...macro.slice(0, at + 1), item, ...macro.slice(at + 1)];
}

export function addMacroItem(item: MacroItem): void {
  const s = rawSettings();
  if (s.macro.some((m) => m.id === item.id)) throw new ActionError(`이미 있는 지표입니다: ${item.id}`);
  saveSettings({ ...s, macro: insertMacroItem(s.macro, item) });
}

export function removeMacroItem(id: string): void {
  const s = rawSettings();
  saveSettings({ ...s, macro: s.macro.filter((m) => m.id !== id), strip: s.strip.filter((x) => x !== id) });
}
