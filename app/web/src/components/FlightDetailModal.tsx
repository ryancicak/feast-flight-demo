import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { ScoreResult } from '../lib/types';
import { RiskGauge } from './RiskGauge';
import { mins, num, pct } from '../lib/format';

// Expanded view of a scored flight, opened by clicking the result tile. The
// compact tile shows the headline; this shows the full feature vector that
// Feast served from Lakebase, grouped the way the feature views are.
export function FlightDetailModal({
  result,
  onClose,
}: {
  result: ScoreResult;
  onClose: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dest = result.route_id.split('-')[1] ?? '';
  const oneQuery = result.mode !== 'feast';

  return (
    <motion.div
      key="flight-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-base/95 p-6 backdrop-blur-xl sm:p-10"
      role="dialog"
      aria-modal="true"
      aria-label="Flight detail"
    >
      <motion.div
        key="flight-card"
        initial={{ opacity: 0, scale: 0.975, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[920px] rounded-3xl border border-hairline/60 bg-panel/50 px-8 py-9 shadow-panel sm:px-12 sm:py-11"
      >
        <div
          className="pointer-events-none absolute -inset-px -z-10 rounded-3xl"
          style={{
            background:
              'radial-gradient(70% 60% at 50% 0%, rgba(56,189,248,0.14), transparent 60%)',
          }}
        />

        <button
          onClick={onClose}
          aria-label="Close flight detail"
          className="absolute right-5 top-5 rounded-lg border border-hairline bg-panel-2 p-2 text-ink-faint transition hover:border-accent/40 hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" strokeLinecap="round" />
          </svg>
        </button>

        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-3 pr-10">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
              Live online inference
            </div>
            <div className="tnum mt-1 text-3xl font-bold tracking-tight text-ink">
              {result.airport_id} <span className="text-ink-faint">to</span> {dest}
            </div>
            <div className="mt-1 text-[13px] text-ink-dim">
              {result.carrier_name} · {result.year}
            </div>
          </div>
          {result.latency_ms !== null && (
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              <span className="tnum text-[12px] font-semibold text-emerald-300">
                {Math.round(result.latency_ms)} ms
              </span>
              <span className="text-[10px] uppercase tracking-wider text-emerald-300/70">
                Lakebase · {oneQuery ? '1 query' : '4 views'}
              </span>
            </div>
          )}
        </div>

        {/* gauge + the three feature-view groups */}
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex justify-center">
            <RiskGauge value={result.blended_delay_risk} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Group title="Origin airport" sub={`${result.airport_id} · ${result.year}`}>
              <Row label="Avg arrival delay" value={mins(result.origin_avg_arr_delay)} />
              <Row label="Delayed 15m+" value={pct(result.origin_delay_rate_15)} />
              <Row label="Flights" value={num(result.origin_flights)} />
            </Group>
            <Group title="Carrier" sub={result.carrier_name}>
              <Row label="Avg arrival delay" value={mins(result.carrier_avg_arr_delay)} />
              <Row label="On-time" value={pct(result.carrier_ontime_pct)} />
              <Row label="Delayed 15m+" value={pct(result.carrier_delay_rate_15)} />
            </Group>
            <Group title="Route" sub={`${result.airport_id}-${dest}`}>
              <Row label="Avg arrival delay" value={mins(result.route_avg_arr_delay)} />
              <Row label="Delayed 15m+" value={pct(result.route_delay_rate_15)} />
              <Row label="Distance" value={`${num(result.route_distance)} mi`} />
            </Group>
            <Group title="Weather" sub={`${result.airport_id} · ${result.year}`}>
              <Row label="Avg high / low" value={tempPair(result.wx_avg_tmax_c, result.wx_avg_tmin_c)} />
              <Row label="Snow / precip days" value={`${dnum(result.wx_snow_days)} / ${dnum(result.wx_precip_days)}`} />
              <Row label="Fog / thunder days" value={`${dnum(result.wx_fog_days)} / ${dnum(result.wx_thunder_days)}`} />
            </Group>
          </div>
        </div>

        {/* raw feature vector */}
        <button
          onClick={() => setShowRaw((s) => !s)}
          className="mt-6 text-[11px] text-ink-faint underline-offset-2 transition hover:text-accent hover:underline"
        >
          {showRaw ? 'Hide' : 'Show'} raw feature vector
        </button>
        {showRaw && (
          <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-hairline bg-base/80 p-3 text-[10px] leading-relaxed text-ink-dim">
            {JSON.stringify(stripUI(result), null, 2)}
          </pre>
        )}

        <p className="mt-5 border-t border-hairline/70 pt-4 text-[11px] leading-relaxed text-ink-dim">
          Every value above was read live from the{' '}
          <span className="text-accent">Lakebase Postgres</span> online store
          {oneQuery
            ? ' in a single query, the same store Feast materialized into.'
            : ' through Feast get_online_features (one read per feature view).'}
        </p>
        <div className="mt-3 text-center text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          Click outside or press Esc to return to the map
        </div>
      </motion.div>
    </motion.div>
  );
}

function Group({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-panel-2/60 px-3.5 py-3">
      <div className="text-[11px] font-semibold tracking-tight text-ink">{title}</div>
      {sub && <div className="tnum mb-2 mt-0.5 text-[10px] text-ink-faint">{sub}</div>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-ink-dim">{label}</span>
      <span className="tnum text-[12px] font-semibold text-ink">{value}</span>
    </div>
  );
}

function dnum(v: number | null): string {
  return v === null ? '—' : String(v);
}

function tempPair(hi: number | null, lo: number | null): string {
  // stored in Celsius (GHCN); shown in Fahrenheit
  const f = (t: number | null) =>
    t === null ? '—' : `${Math.round(t * 9 / 5 + 32)}`;
  return `${f(hi)} / ${f(lo)} °F`;
}

function stripUI(r: ScoreResult) {
  const { carrier_name: _c, latency_ms: _l, mode: _m, ...rest } = r;
  return rest;
}
