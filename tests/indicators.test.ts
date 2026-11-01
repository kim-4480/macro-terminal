import { describe, expect, it } from 'vitest';
import type { MacroItem } from '@/server/config';
import { insertMacroItem, summarizeSeries } from '@/server/indicators';
import { csvDateToIso, parseCsv, parseCsvSpec } from '@/server/sources/csv';
import { dataLinks, parseBingWeb, parseDuckDuckGo } from '@/server/sources/web';

describe('CSV 시계열', () => {
  it('reads the path form', () => {
    expect(parseCsvSpec('https://x.org/a.csv#date=TIME&value=OBS&where=GEO:DE')).toEqual({ url: 'https://x.org/a.csv', date: 'TIME', value: 'OBS', where: { column: 'GEO', value: 'DE' } });
    expect(parseCsvSpec('https://x.org/a.csv')).toMatchObject({ date: null, value: null, where: null });
    expect(() => parseCsvSpec('http://x.org/a.csv')).toThrow();
    expect(() => parseCsvSpec('file:///etc/passwd')).toThrow();
  });

  it('understands common date forms', () => {
    expect(csvDateToIso('2026-08-15')).toBe('2026-08-15');
    expect(csvDateToIso('2026/8/5')).toBe('2026-08-05');
    expect(csvDateToIso('2026-08')).toBe('2026-08-01');
    expect(csvDateToIso('202608')).toBe('2026-08-01');
    expect(csvDateToIso('2026-M08')).toBe('2026-08-01');
    expect(csvDateToIso('2026-Q2')).toBe('2026-04-01');
    expect(csvDateToIso('n/a')).toBeNull();
  });

  it('picks columns and rows, skips missing values, sorts by date', () => {
    const text = '﻿GEO;TIME;"OBS"\nDE;2026-02;1.5\nFR;2026-02;9\nDE;2026-01;1,5x\nDE;2025-12;1.2\n';
    expect(parseCsv(text, { date: 'time', value: 'OBS', where: { column: 'GEO', value: 'DE' } })).toEqual([['2025-12-01', 1.2], ['2026-02-01', 1.5]]);
  });

  it('defaults to first and last columns and names a missing column', () => {
    expect(parseCsv('date,a,b\n2026-01-01,5,7\n', { date: null, value: null, where: null })).toEqual([['2026-01-01', 7]]);
    expect(() => parseCsv('date,a\n', { date: 'x', value: null, where: null })).toThrow('date, a');
  });
});

describe('웹 검색 결과', () => {
  it('parses DuckDuckGo results and unwraps redirects, skipping ads', () => {
    const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/y.js?ad=1">Ad</a><a class="result__snippet" href="x">ad</a>
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffred.stlouisfed.org%2Fseries%2FABC&amp;rut=1">Unemployment <b>Rate</b></a>
      <a class="result__snippet" href="x">Monthly &amp; seasonally adjusted</a>`;
    expect(parseDuckDuckGo(html)).toEqual([{ title: 'Unemployment Rate', url: 'https://fred.stlouisfed.org/series/ABC', snippet: 'Monthly & seasonally adjusted' }]);
  });

  it('parses Bing RSS items', () => {
    expect(parseBingWeb('<item><title>T</title><link>https://a.org/</link><description>D</description></item>')).toEqual([{ title: 'T', url: 'https://a.org/', snippet: 'D' }]);
  });

  it('collects data-like https links only', () => {
    const html = '<a href="/files/x.csv">a</a><a href="https://o.org/about">b</a><a href="http://o.org/y.csv">c</a><a href="/api/v1/q">d</a>';
    expect(dataLinks(html, 'https://o.org/p')).toEqual(['https://o.org/files/x.csv', 'https://o.org/api/v1/q']);
  });
});

describe('지표 목록', () => {
  const item = (id: string, group: string): MacroItem => ({ id: `fred:${id}`, group, label: id, unit: '' });

  it('keeps groups together', () => {
    const list = [item('A', 'US'), item('B', 'US'), item('C', 'Global')];
    expect(insertMacroItem(list, item('D', 'US')).map((m) => m.id)).toEqual(['fred:A', 'fred:B', 'fred:D', 'fred:C']);
    expect(insertMacroItem(list, item('E', 'Germany')).at(-1)!.id).toBe('fred:E');
  });

  it('summarizes what a series really holds', () => {
    const s = summarizeSeries('fred:X', [['2025-01-01', 1], ['2025-02-01', 2], ['2026-01-01', 3]], 'Title');
    expect(s).toMatchObject({ title: 'Title', observations: 3, observationsPerYear: 2, firstDate: '2025-01-01', lastDate: '2026-01-01' });
    expect(() => summarizeSeries('fred:X', [], null)).toThrow();
  });
});
