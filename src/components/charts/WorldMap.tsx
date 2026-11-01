'use client';

import { geoCentroid, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import { countryName, toAlpha2, toNumeric } from '@/lib/countries';
import { useLang } from '@/lib/i18n';
import { useWidth } from '@/lib/useWidth';
import { CITIES, SMALL_PLACES } from '@/shared/geo';
import type { MapNewsItem } from '@/shared/types';

// Natural Earth 1:110m 국경(world-atlas). 남극은 뺀다.
const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const LAND = (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>).features
  .filter((f) => f.id !== '010');
const BY_NUMERIC = new Map(LAND.filter((f) => f.id != null).map((f) => [String(f.id), f]));

/** 기사 위치 → 지도 좌표: 알려진 도시 > 작은 나라 표 > 국가 중심 */
export function placeOf(item: Pick<MapNewsItem, 'country' | 'city'>): [number, number] | null {
  if (!item.country) return null;
  if (item.city && CITIES[item.city]) return CITIES[item.city]!.coord;
  if (SMALL_PLACES[item.country]) return SMALL_PLACES[item.country]!;
  const num = toNumeric(item.country);
  const f = num ? BY_NUMERIC.get(num) : undefined;
  return f ? (geoCentroid(f as GeoPermissibleObjects) as [number, number]) : null;
}

interface Marker {
  key: string;
  country: string;
  city: string | null;
  coord: [number, number];
  items: MapNewsItem[];
}

export function WorldMap({ items, selected, onSelect }: { items: MapNewsItem[]; selected: string | null; onSelect: (iso2: string | null) => void }) {
  const { lang } = useLang();
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const W = Math.max(320, measured);
  const H = Math.round(W * 0.5);

  const { path, project } = useMemo(() => {
    const projection = geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'FeatureCollection', features: LAND } as GeoPermissibleObjects);
    return { path: geoPath(projection), project: (c: [number, number]) => projection(c) };
  }, [W, H]);

  // 국가별 기사 수(채색) · 위치별 마커
  const { counts, markers, max } = useMemo(() => {
    const counts = new Map<string, number>();
    const markers = new Map<string, Marker>();
    for (const it of items) {
      if (!it.country) continue;
      counts.set(it.country, (counts.get(it.country) ?? 0) + 1);
      const coord = placeOf(it);
      if (!coord) continue;
      const key = it.city && CITIES[it.city] ? `c:${it.city}` : `n:${it.country}`;
      const m = markers.get(key) ?? { key, country: it.country, city: it.city && CITIES[it.city] ? it.city : null, coord, items: [] };
      m.items.push(it);
      markers.set(key, m);
    }
    return { counts, markers: [...markers.values()].sort((a, b) => b.items.length - a.items.length), max: Math.max(1, ...counts.values()) };
  }, [items]);

  const label = (m: Marker) => (m.city ? `${lang === 'ko' ? CITIES[m.city]!.ko : m.city.replace(/\b\w/g, (c) => c.toUpperCase())} · ${countryName(m.country, lang)}` : countryName(m.country, lang));

  return (
    <div ref={ref} className="worldmap" onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="news map">
        <path d={path({ type: 'Sphere' } as GeoPermissibleObjects) ?? undefined} className="sphere" />
        {LAND.map((f, i) => {
          // 코소보·북키프로스 등은 숫자 코드가 없어 id 가 비어 있다
          const iso2 = f.id != null ? toAlpha2(String(f.id)) : undefined;
          const n = iso2 ? counts.get(iso2) ?? 0 : 0;
          const cls = ['land', n ? 'has' : '', iso2 && iso2 === selected ? 'sel' : ''].join(' ');
          return (
            <path
              key={f.id != null ? String(f.id) : `${f.properties.name}-${i}`}
              d={path(f as Feature) ?? undefined}
              className={cls}
              style={n ? { fillOpacity: 0.18 + 0.6 * (n / max) } : undefined}
              onClick={() => onSelect(iso2 && n ? (iso2 === selected ? null : iso2) : null)}
              onMouseMove={(e) => {
                if (!iso2 || !n) { setHover(null); return; }
                const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setHover({ x: e.clientX - r.left, y: e.clientY - r.top, title: countryName(iso2, lang), sub: `${n}` });
              }}
            />
          );
        })}
        {markers.map((m) => {
          const p = project(m.coord);
          if (!p) return null;
          const r = 5 + 3.2 * Math.sqrt(m.items.length);
          const on = m.country === selected;
          return (
            <g
              key={m.key}
              className={`marker${on ? ' sel' : ''}`}
              transform={`translate(${p[0]},${p[1]})`}
              onClick={(e) => { e.stopPropagation(); onSelect(on ? null : m.country); }}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                const top = m.items[0];
                setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, title: label(m), sub: `${m.items.length} · ${top?.titleT ?? top?.title ?? ''}` });
              }}
            >
              <circle r={r + 5} className="halo" />
              <circle r={r} className="dot" />
              {m.items.length > 1 ? <text dy="0.35em" textAnchor="middle">{m.items.length}</text> : null}
            </g>
          );
        })}
      </svg>
      {hover ? (
        <div className="map-tip" style={{ left: Math.min(hover.x + 14, W - 260), top: hover.y + 14 }}>
          <b>{hover.title}</b>
          <span>{hover.sub}</span>
        </div>
      ) : null}
    </div>
  );
}
