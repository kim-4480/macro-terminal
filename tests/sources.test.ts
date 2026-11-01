import { describe, expect, it } from 'vitest';
import { ecosTimeToIso } from '@/server/sources/ecos';
import { parseFredCsv } from '@/server/sources/fred';
import { parseKrxHtml } from '@/server/sources/krx';
import { decodeXml, mergeNews, parseRss, type RawNewsItem } from '@/server/sources/news';

describe('parseFredCsv', () => {
  it('skips missing values', () => {
    const csv = 'observation_date,DGS10\n2026-10-20,4.90\n2026-10-21,.\n2026-10-22,4.96\n';
    expect(parseFredCsv('DGS10', csv)).toEqual([['2026-10-20', 4.9], ['2026-10-22', 4.96]]);
  });
  it('rejects non-CSV responses', () => {
    expect(() => parseFredCsv('X', '<html>')).toThrow();
  });
});

describe('ecosTimeToIso', () => {
  it('converts each cycle', () => {
    expect(ecosTimeToIso('D', '20261022')).toBe('2026-10-22');
    expect(ecosTimeToIso('M', '202609')).toBe('2026-09-01');
    expect(ecosTimeToIso('Q', '2026Q3')).toBe('2026-07-01');
    expect(ecosTimeToIso('A', '2026')).toBe('2026-01-01');
  });
});

describe('news RSS', () => {
  it('decodes entities without double-decoding', () => {
    expect(decodeXml('AT&amp;T &amp;lt;b&amp;gt;')).toBe('AT&T &lt;b&gt;');
    expect(decodeXml('<![CDATA[Fed & rates]]>')).toBe('Fed & rates');
  });

  it('parses items and strips the " - Source" suffix', () => {
    const xml = `<rss><channel>
      <item><title>Chip demand rises - Reuters</title><link>https://n/1</link><pubDate>Sun, 25 Oct 2026 10:00:00 GMT</pubDate><source url="x">Reuters</source></item>
      <item><title>반도체 수출 증가 - 연합뉴스</title><link>https://n/2</link><pubDate>bad</pubDate><source url="y">연합뉴스</source></item>
    </channel></rss>`;
    const items = parseRss(xml, 'en');
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe('Chip demand rises');
    expect(items[0]!.source).toBe('Reuters');
    expect(items[0]!.published).toBe(Date.parse('Sun, 25 Oct 2026 10:00:00 GMT'));
    expect(items[1]!.title).toBe('반도체 수출 증가');
    expect(items[1]!.published).toBeNull();
  });

  it('merges languages alternately, dedupes, and sorts newest first', () => {
    const mk = (id: string, lang: 'en' | 'ko', published: number): RawNewsItem => ({ id, title: id, lang, source: 's', link: '', published });
    const out = mergeNews([[mk('a', 'en', 5), mk('b', 'en', 4), mk('c', 'en', 3)], [mk('x', 'ko', 1), mk('a', 'en', 5)]], 3);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'x']);
  });
});

describe('parseKrxHtml', () => {
  it('maps 유가 to .KS, 코스닥 to .KQ and drops 코넥스', () => {
    const html = `<table>
      <tr><th>회사명</th></tr>
      <tr><td>카카오</td><td> 유가 </td><td>035720</td><td>포털</td><td>x</td></tr>
      <tr><td>카카오게임즈</td><td>코스닥</td><td>293490</td><td>게임</td><td>x</td></tr>
      <tr><td>어떤회사</td><td>코넥스</td><td>123456</td><td>기타</td><td>x</td></tr>
    </table>`;
    expect(parseKrxHtml(html)).toEqual([
      { name: '카카오', market: '코스피', symbol: '035720.KS', sector: '포털' },
      { name: '카카오게임즈', market: '코스닥', symbol: '293490.KQ', sector: '게임' },
    ]);
  });
});
