import { useEffect, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { scoreFlight } from '../lib/api';
import type { Airport, Carrier, ScoreResult } from '../lib/types';
import { Combobox, type Option } from './Combobox';
import { RiskGauge } from './RiskGauge';
import { mins, num, pct } from '../lib/format';

interface ScorePanelProps {
  airports: Airport[];
  carriers: Carrier[];
  year: number;
  origin: string | null;
  dest: string | null;
  carrier: string | null;
  onOrigin: (code: string | null) => void;
  onDest: (code: string | null) => void;
  onCarrier: (code: string | null) => void;
  scoreSignal: number;
  onScored?: (result: ScoreResult) => void;
  onExpand?: () => void;
  compareMode: boolean;
  compareCount: number;
  onToggleCompare: () => void;
}

export function ScorePanel({
  airports,
  carriers,
  year,
  origin,
  dest,
  carrier,
  onOrigin,
  onDest,
  onCarrier,
  scoreSignal,
  onScored,
  onExpand,
  compareMode,
  compareCount,
  onToggleCompare,
}: ScorePanelProps) {

  const airportOpts: Option[] = useMemo(
    () =>
      airports.map((a) => ({ code: a.code, label: a.name, sub: a.city })),
    [airports],
  );
  const carrierOpts: Option[] = useMemo(
    () => carriers.map((c) => ({ code: c.code, label: c.name })),
    [carriers],
  );

  const mutation = useMutation({
    mutationFn: () =>
      scoreFlight({
        origin: origin!,
        dest: dest!,
        carrier: carrier!,
        year,
      }),
    onSuccess: (result) => onScored?.(result),
  });

  const ready = origin && dest && carrier;
  const result = mutation.data;

  // The map can drop an airport into the score and ask for a re-run by bumping
  // scoreSignal (see App.useAirportAs). Score whenever it changes (not on load).
  useEffect(() => {
    if (scoreSignal > 0 && origin && dest && carrier) mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreSignal]);

  return (
    <div className="space-y-3">
      <Combobox
        label="Origin"
        options={airportOpts}
        value={origin}
        onChange={onOrigin}
        placeholder="Origin airport"
      />
      <Combobox
        label="Destination"
        options={airportOpts}
        value={dest}
        onChange={onDest}
        placeholder="Destination airport"
      />
      <Combobox
        label="Carrier"
        options={carrierOpts}
        value={carrier}
        onChange={onCarrier}
        placeholder="Airline"
      />

      <button
        disabled={!ready || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-[13px] font-semibold text-base transition hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-40"
      >
        {mutation.isPending ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-base/40 border-t-base" />
            Scoring live…
          </>
        ) : (
          <>Score this flight · {year}</>
        )}
      </button>

      <button
        onClick={onToggleCompare}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition ${
          compareMode
            ? 'border-accent/50 bg-accent/10 text-accent'
            : 'border-hairline bg-panel-2 text-ink-dim hover:border-accent/40 hover:text-ink'
        }`}
      >
        {compareMode
          ? `Comparing across years · ${compareCount}`
          : 'Compare across years'}
      </button>
      {compareMode && (
        <p className="-mt-1 text-center text-[10px] leading-relaxed text-ink-faint">
          Change the year (or pick an airport) and score to add it.
        </p>
      )}

      <AnimatePresence mode="wait">
        {mutation.isError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-lg border border-risk-high/40 bg-risk-high/10 px-3 py-2 text-[12px] text-risk-high"
          >
            Scoring failed — is the backend running?
          </motion.div>
        )}

        {result && (
          <motion.div
            key={`${result.airport_id}-${result.route_id}-${result.year}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={() => onExpand?.()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onExpand?.();
            }}
            className="group cursor-pointer space-y-3 rounded-xl border border-hairline bg-panel-2/70 p-4 transition hover:border-accent/40 hover:bg-panel-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="tnum text-sm font-bold tracking-tight text-ink">
                  {result.airport_id} → {result.route_id.split('-')[1]}
                </div>
                <div className="text-[11px] text-ink-dim">
                  {result.carrier_name} · {result.year}
                </div>
              </div>
              <LakebaseBadge />
            </div>

            <div className="flex items-center justify-center py-1">
              <RiskGauge value={result.blended_delay_risk} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Metric
                label="Origin delay"
                value={mins(result.origin_avg_arr_delay)}
                sub={`${pct(result.origin_delay_rate_15)} late`}
              />
              <Metric
                label="Carrier delay"
                value={mins(result.carrier_avg_arr_delay)}
                sub={`${pct(result.carrier_ontime_pct)} on-time`}
              />
              <Metric
                label="Route delay"
                value={mins(result.route_avg_arr_delay)}
                sub={`${num(result.route_distance)} mi`}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <WxChip label="snow" value={result.wx_snow_days} unit="d" />
              <WxChip label="fog" value={result.wx_fog_days} unit="d" />
              <WxChip label="thunder" value={result.wx_thunder_days} unit="d" />
              {result.wx_avg_tmax_c !== null && (
                <WxChip
                  label="high"
                  value={Math.round(result.wx_avg_tmax_c * 9 / 5 + 32)}
                  unit="°F"
                />
              )}
            </div>

            <div className="flex items-center justify-center gap-1.5 pt-0.5 text-[11px] text-ink-faint transition group-hover:text-accent">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
              Click for full breakdown
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LakebaseBadge() {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
        live · Lakebase Postgres
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-hairline/70 bg-base/40 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      <div className="tnum text-[15px] font-semibold text-ink">{value}</div>
      <div className="tnum text-[10px] text-ink-dim">{sub}</div>
    </div>
  );
}

function WxChip({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string;
}) {
  return (
    <span className="tnum inline-flex items-center gap-1 rounded-full border border-hairline bg-panel px-2.5 py-1 text-[10px] text-ink-dim">
      <span className="text-ink-faint">{label}</span>
      <span className="font-semibold text-ink">
        {value === null ? '—' : `${value}${unit}`}
      </span>
    </span>
  );
}
