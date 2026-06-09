import { useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { WebMercatorViewport } from '@deck.gl/core';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import type { ColorMode, MapPoint, ScoredArc } from '../lib/types';
import { colorForMode, radiusFor, riskColor, type RGB } from '../lib/scale';
import { mins, num, pct } from '../lib/format';

const CARTO_DARK =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Continental US, roughly. We fit this to the viewport so the map frames the
// country on any screen instead of a fixed desktop zoom that crops on a phone.
const US_BOUNDS: [[number, number], [number, number]] = [
  [-124.5, 24.5],
  [-66.8, 49.4],
];

function computeInitialView() {
  const width = typeof window !== 'undefined' ? window.innerWidth : 1400;
  const height = typeof window !== 'undefined' ? window.innerHeight : 820;
  // Desktop framing is already good; keep it.
  if (width >= 640) {
    return { longitude: -97, latitude: 39, zoom: 3.45, pitch: 0, bearing: 0 };
  }
  // Mobile: fit the US into the clear band between the top chrome and the
  // bottom sheet/scrubber.
  try {
    const vp = new WebMercatorViewport({ width, height });
    const { longitude, latitude, zoom } = vp.fitBounds(US_BOUNDS, {
      padding: { top: 140, bottom: 150, left: 18, right: 18 },
    });
    return { longitude, latitude, zoom, pitch: 0, bearing: 0 };
  } catch {
    return { longitude: -97, latitude: 38.5, zoom: 2.2, pitch: 0, bearing: 0 };
  }
}

interface FlightMapProps {
  points: MapPoint[];
  colorMode: ColorMode;
  selectedCode: string | null;
  onSelect: (code: string) => void;
  scoredArc: ScoredArc | null;
}

interface HoverInfo {
  x: number;
  y: number;
  point: MapPoint;
}

export function FlightMap({
  points,
  colorMode,
  selectedCode,
  onSelect,
  scoredArc,
}: FlightMapProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [initialView] = useState(computeInitialView);

  const layers = useMemo(() => {
    const getColor = (p: MapPoint): RGB => colorForMode(p, colorMode);
    // While a flight is scored, fade the field and keep only its two airports
    // lit, so focus lands on the route.
    const focused = !!scoredArc;
    const isEnd = (p: MapPoint) =>
      !!scoredArc && (p.code === scoredArc.origin || p.code === scoredArc.dest);
    const arcRGB: RGB = scoredArc
      ? riskColor(Math.min(1, (scoredArc.risk ?? 0) / 0.35))
      : [56, 189, 248];

    const base = [
      // soft outer glow ring
      new ScatterplotLayer<MapPoint>({
        id: `glow-${colorMode}`,
        data: points,
        getPosition: (p) => [p.lon, p.lat],
        getRadius: (p) => radiusFor(p.flights) * 2.2,
        getFillColor: (p) => {
          const [r, g, b] = getColor(p);
          return [r, g, b, focused ? (isEnd(p) ? 70 : 8) : 38];
        },
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 90,
        stroked: false,
        pickable: false,
        updateTriggers: { getFillColor: [colorMode, scoredArc?.origin, scoredArc?.dest] },
        transitions: { getFillColor: 500, getRadius: 700 },
      }),
      // core dots
      new ScatterplotLayer<MapPoint>({
        id: `dots-${colorMode}`,
        data: points,
        getPosition: (p) => [p.lon, p.lat],
        getRadius: (p) => radiusFor(p.flights),
        getFillColor: (p) => {
          const [r, g, b] = getColor(p);
          return [r, g, b, focused ? (isEnd(p) ? 255 : 40) : 235];
        },
        getLineColor: (p) =>
          p.code === selectedCode || isEnd(p)
            ? [232, 237, 245, 255]
            : [10, 14, 20, 160],
        getLineWidth: (p) =>
          p.code === selectedCode || isEnd(p) ? 2.4 : 0.6,
        lineWidthUnits: 'pixels',
        radiusUnits: 'meters',
        radiusMinPixels: 2,
        radiusMaxPixels: 42,
        stroked: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        onHover: (info) =>
          setHover(
            info.object
              ? { x: info.x, y: info.y, point: info.object as MapPoint }
              : null,
          ),
        onClick: (info) => {
          if (info.object) onSelect((info.object as MapPoint).code);
        },
        updateTriggers: {
          getFillColor: [colorMode, scoredArc?.origin, scoredArc?.dest],
          getLineColor: [selectedCode, scoredArc?.origin, scoredArc?.dest],
          getLineWidth: [selectedCode, scoredArc?.origin, scoredArc?.dest],
        },
        transitions: { getFillColor: 500, getRadius: 700 },
      }),
    ];

    if (!scoredArc) return base;

    // the scored flight: a soft-glow arc under a crisp arc, plus a ring on each
    // endpoint airport
    return [
      ...base,
      new ArcLayer<ScoredArc>({
        id: 'score-arc-glow',
        data: [scoredArc],
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.to,
        getSourceColor: [...arcRGB, 70],
        getTargetColor: [...arcRGB, 70],
        getWidth: 10,
        getHeight: 0.4,
        widthUnits: 'pixels',
        updateTriggers: { getSourceColor: arcRGB, getTargetColor: arcRGB },
      }),
      new ArcLayer<ScoredArc>({
        id: 'score-arc',
        data: [scoredArc],
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.to,
        getSourceColor: [...arcRGB, 255],
        getTargetColor: [...arcRGB, 255],
        getWidth: 2.5,
        getHeight: 0.4,
        widthUnits: 'pixels',
        updateTriggers: { getSourceColor: arcRGB, getTargetColor: arcRGB },
      }),
      new ScatterplotLayer<[number, number]>({
        id: 'score-endpoints',
        data: [scoredArc.from, scoredArc.to],
        getPosition: (d) => d,
        getRadius: 6,
        radiusUnits: 'pixels',
        radiusMinPixels: 6,
        getFillColor: [0, 0, 0, 0],
        stroked: true,
        getLineColor: [...arcRGB, 255],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        updateTriggers: { getLineColor: arcRGB },
      }),
    ];
  }, [points, colorMode, selectedCode, onSelect, scoredArc]);

  return (
    <div className="absolute inset-0">
      <DeckGL
        initialViewState={initialView}
        controller={{ dragRotate: false }}
        layers={layers}
        getCursor={({ isDragging, isHovering }) =>
          isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
        }
      >
        <Map mapStyle={CARTO_DARK} attributionControl={false} reuseMaps />
      </DeckGL>

      {hover && (
        <div
          className="pointer-events-none absolute z-30 hidden w-60 -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-xl border border-hairline bg-panel/95 px-3.5 py-3 shadow-glow backdrop-blur-md sm:block"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold tracking-tight text-ink">
              {hover.point.code}
            </span>
            <span className="tnum text-[11px] text-ink-faint">
              {num(hover.point.flights)} flights
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-ink-dim">
            {hover.point.name}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <Stat label="% delayed" value={pct(hover.point.delay_rate, 1)} />
            <Stat label="avg delay" value={mins(hover.point.avg_delay)} />
            <Stat label="snow" value={`${hover.point.snow_days ?? '—'}d`} />
            <Stat
              label="storms"
              value={`${
                (hover.point.thunder_days ?? 0) + (hover.point.fog_days ?? 0)
              }d`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      <div className="tnum text-[13px] font-semibold text-ink">{value}</div>
    </div>
  );
}
