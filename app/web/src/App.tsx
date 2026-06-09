import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useCarriers, useMap, useMeta } from './hooks/useData';
import { fetchCarriers, fetchMap } from './lib/api';
import { useDebounced } from './hooks/useDebounced';
import { recordLatency } from './lib/telemetry';
import type { ColorMode, ScoredArc, ScoreResult } from './lib/types';
import { FlightMap } from './components/FlightMap';
import { YearScrubber } from './components/YearScrubber';
import { TopBar } from './components/TopBar';
import { ColorToggle } from './components/ColorToggle';
import { ScorePanel } from './components/ScorePanel';
import { CarrierLeaderboard } from './components/CarrierLeaderboard';
import { AirportPanel } from './components/AirportPanel';
import { Legend } from './components/Legend';
import { Panel } from './components/Panel';
import { ArchitectureModal } from './components/ArchitectureModal';
import { FlightDetailModal } from './components/FlightDetailModal';
import { CompareDock } from './components/CompareDock';
import { LatencyHud } from './components/LatencyHud';

const DEFAULT_YEAR = 2007;

export default function App() {
  const { data: meta, isLoading: metaLoading, isError: metaError } = useMeta();
  const queryClient = useQueryClient();

  const [year, setYear] = useState(DEFAULT_YEAR);
  const [colorMode, setColorMode] = useState<ColorMode>('delay');
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [archOpen, setArchOpen] = useState(false);
  const [scored, setScored] = useState<ScoreResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false); // mobile: score sheet collapsed by default

  // Score inputs live here so the map (click an airport) can drop it into the
  // score and trigger a re-run. Bumping scoreSignal tells ScorePanel to score.
  const [origin, setOrigin] = useState<string | null>('ORD');
  const [dest, setDest] = useState<string | null>('LAX');
  const [carrier, setCarrier] = useState<string | null>('AA');
  const [scoreSignal, setScoreSignal] = useState(0);

  // Compare mode: pin the same flight scored across years, side by side.
  const [compareMode, setCompareMode] = useState(false);
  const [compare, setCompare] = useState<ScoreResult[]>([]);

  const useAirportAs = (which: 'origin' | 'dest') => (code: string) => {
    if (which === 'origin') setOrigin(code);
    else setDest(code);
    setScoreSignal((n) => n + 1); // ScorePanel re-scores with the new inputs
  };

  // Every score updates the arc/detail; in compare mode it also pins to the
  // strip (deduped by year, reset when the route or carrier changes).
  const handleScored = (r: ScoreResult) => {
    setScored(r);
    if (!compareMode) return;
    setCompare((prev) => {
      const sameFlight =
        prev.length > 0 &&
        prev[0].route_id === r.route_id &&
        prev[0].carrier_id === r.carrier_id;
      const kept = sameFlight ? prev.filter((x) => x.year !== r.year) : [];
      return [...kept, r];
    });
  };

  const toggleCompare = () => {
    setCompareMode((on) => {
      const next = !on;
      setCompare(next && scored ? [scored] : []);
      return next;
    });
  };

  // Resolve the scored flight to a map arc (origin -> dest coords + risk color).
  const scoredArc = useMemo<ScoredArc | null>(() => {
    if (!scored || !meta) return null;
    const origin = scored.airport_id;
    const dest = scored.route_id.split('-')[1];
    const coord = (code: string) => {
      const a = meta.airports.find((x) => x.code === code);
      return a ? ([a.lon, a.lat] as [number, number]) : null;
    };
    const from = coord(origin);
    const to = coord(dest);
    if (!from || !to) return null;
    return { from, to, origin, dest, risk: scored.blended_delay_risk };
  }, [scored, meta]);

  // debounce the year used for fetching so dragging stays smooth
  const fetchYear = useDebounced(year, 110);
  const { data: mapPoints } = useMap(fetchYear);
  const { data: carriers } = useCarriers(fetchYear);

  const points = mapPoints ?? [];

  const selectedPoint = useMemo(
    () => points.find((p) => p.code === selected),
    [points, selected],
  );

  const totalFlights = useMemo(
    () => (points.length ? points.reduce((s, p) => s + p.flights, 0) : null),
    [points],
  );

  // stop autoplay at the final year
  useEffect(() => {
    const lastYear = meta?.years[meta.years.length - 1];
    if (playing && year === lastYear) {
      const t = setTimeout(() => setPlaying(false), 1100);
      return () => clearTimeout(t);
    }
  }, [playing, year, meta]);

  // Prefetch every year's map + carrier data once meta loads, so scrubbing and
  // Play are pure cache hits (zero network per year) — buttery, no first-pass lag.
  useEffect(() => {
    if (!meta) return;
    for (const y of meta.years) {
      queryClient.prefetchQuery({
        queryKey: ['map', y], queryFn: () => fetchMap(y), staleTime: 5 * 60 * 1000,
      });
      queryClient.prefetchQuery({
        queryKey: ['carriers', y], queryFn: () => fetchCarriers(y), staleTime: 5 * 60 * 1000,
      });
    }
  }, [meta, queryClient]);

  // Reflect year scrubbing / Play in the latency HUD. Those years were prefetched
  // above, so they resolve from the react-query cache with no network — we time
  // the cache read and label it, so an instant Play step still lights up the
  // widget (and reads as the <1ms cache hit it is, not a Lakebase call).
  useEffect(() => {
    if (!meta) return;
    const t0 = performance.now();
    const cached = queryClient.getQueryData(['map', fetchYear]);
    if (cached) {
      recordLatency({
        source: 'cache',
        ms: performance.now() - t0,
        label: `cache · ${fetchYear}`,
      });
    }
  }, [fetchYear, meta, queryClient]);

  if (metaError) {
    return (
      <Centered>
        <div className="text-center">
          <p className="text-sm text-risk-high">Could not reach the API.</p>
          <p className="mt-1 text-xs text-ink-dim">
            Start the backend: <code className="text-accent">uvicorn server:app --port 8000</code>
          </p>
        </div>
      </Centered>
    );
  }

  if (metaLoading || !meta) {
    return (
      <Centered>
        <Loader />
      </Centered>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-base">
      {/* Hero map fills the viewport */}
      <FlightMap
        points={points}
        colorMode={colorMode}
        selectedCode={selected}
        onSelect={setSelected}
        scoredArc={scoredArc}
      />

      {/* vignette for depth + legibility under the chrome */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,transparent_55%,rgba(5,8,13,0.6)_100%)]" />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 p-4">
        <TopBar
          airportCount={meta.airports.length}
          carrierCount={meta.carriers.length}
          yearCount={meta.years.length}
          totalFlights={totalFlights}
          onOpenArchitecture={() => {
            setPlaying(false); // pause the year animation while reading the architecture
            setArchOpen(true);
          }}
        />
      </div>

      {/* Map color toggle + live latency readout (top-left under bar) */}
      <div className="absolute left-4 top-[88px] z-20 flex flex-col items-start gap-2.5">
        <div className="pointer-events-auto">
          <ColorToggle mode={colorMode} onChange={setColorMode} />
        </div>
        <LatencyHud />
      </div>

      {/* Legend (bottom-left, above scrubber) — yields to the compare strip; desktop only */}
      {!(compareMode && compare.length > 0) && (
        <div className="absolute bottom-[148px] left-4 z-20 hidden sm:block">
          <Legend mode={colorMode} />
        </div>
      )}

      {/* Compare strip (bottom, spans the map but clears the right rail); desktop only */}
      {compareMode && compare.length > 0 && (
        <div className="absolute bottom-[148px] left-4 right-[368px] z-20 hidden sm:block">
          <CompareDock items={compare} onClear={() => setCompare([])} onPick={setYear} />
        </div>
      )}

      {/* Right rail on desktop; a collapsible bottom sheet (above the scrubber) on mobile */}
      <div className="absolute z-20 inset-x-2 bottom-[96px] rounded-2xl border border-hairline bg-base/85 p-2 backdrop-blur-xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[88px] sm:w-[348px] sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {/* mobile-only handle: tap to open/close, shows the last result when collapsed */}
        <button
          onClick={() => setSheetOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left sm:hidden"
          aria-expanded={sheetOpen}
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            {scored ? (
              <>
                <span className="tnum">
                  {scored.airport_id} → {scored.route_id.split('-')[1]}
                </span>
                <span className="tnum text-accent">
                  {Math.round((scored.blended_delay_risk ?? 0) * 100)}%
                </span>
              </>
            ) : (
              'Score a flight'
            )}
          </span>
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-faint">
            {sheetOpen ? 'Hide' : 'Open'}
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform ${sheetOpen ? '' : 'rotate-180'}`}
            >
              <path d="m6 15 6-6 6 6" />
            </svg>
          </span>
        </button>

        {/* content: collapsed on mobile until opened; always shown on desktop */}
        <div
          className={`flex-col gap-3 ${sheetOpen ? 'flex' : 'hidden'} mt-1 max-h-[58vh] overflow-y-auto sm:mt-0 sm:flex sm:max-h-none sm:overflow-visible`}
        >
          <Panel eyebrow="Live online inference" title="Score a flight">
            <ScorePanel
              airports={meta.airports}
              carriers={meta.carriers}
              year={year}
              origin={origin}
              dest={dest}
              carrier={carrier}
              onOrigin={setOrigin}
              onDest={setDest}
              onCarrier={setCarrier}
              scoreSignal={scoreSignal}
              onScored={handleScored}
              onExpand={() => setDetailOpen(true)}
              compareMode={compareMode}
              compareCount={compare.length}
              onToggleCompare={toggleCompare}
            />
          </Panel>
          <Panel
            eyebrow={`On-time leaders · ${fetchYear}`}
            title="Carrier leaderboard"
          >
            {carriers && carriers.length > 0 ? (
              <CarrierLeaderboard carriers={carriers} />
            ) : (
              <div className="py-6 text-center text-xs text-ink-faint">
                No carrier data for this year.
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Airport detail panel (bottom-left, slides in on click); desktop only */}
      <div className="absolute bottom-[148px] left-4 z-30 hidden sm:block">
        <AnimatePresence>
          {selected && (
            <AirportPanel
              code={selected}
              year={fetchYear}
              point={selectedPoint}
              onClose={() => setSelected(null)}
              onUseAsOrigin={useAirportAs('origin')}
              onUseAsDest={useAirportAs('dest')}
              isOrigin={selected === origin}
              isDest={selected === dest}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Year scrubber — full width along the bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-2 sm:p-4">
        <YearScrubber
          years={meta.years}
          year={year}
          onChange={setYear}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
        />
      </div>

      {/* Architecture modal — full-screen animated data-flow diagram */}
      <AnimatePresence>
        {archOpen && <ArchitectureModal onClose={() => setArchOpen(false)} />}
      </AnimatePresence>

      {/* Scored-flight detail — full-screen takeover, opened from the result tile */}
      <AnimatePresence>
        {detailOpen && scored && (
          <FlightDetailModal result={scored} onClose={() => setDetailOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-base">
      {children}
    </div>
  );
}

function Loader() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center gap-3"
    >
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-accent" />
      <span className="text-xs uppercase tracking-[0.2em] text-ink-faint">
        Initializing mission control
      </span>
    </motion.div>
  );
}
