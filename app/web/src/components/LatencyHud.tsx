import { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { getLatency, subscribeLatency, type LatencySource } from '../lib/telemetry';

// Telemetry readout under the map-color toggle. A static "LATENCY" eyebrow tells
// you what the widget is; the per-call label tells you which layer was hit, so
// each reading is honest about what it measured:
//   lakebase - live Feast -> Lakebase Postgres online read (scoring), emerald + ping
//   cache    - prefetched year scrub / Play step from memory, accent, "<1 ms"
//   ui       - cold parquet fetch from the app before it is cached, dim slate
const STYLE: Record<LatencySource, { dot: string; num: string; label: string; ping: boolean }> = {
  lakebase: { dot: 'bg-emerald-400', num: 'text-emerald-300', label: 'text-emerald-300/80', ping: true },
  cache: { dot: 'bg-accent', num: 'text-accent', label: 'text-accent/75', ping: false },
  ui: { dot: 'bg-ink-faint', num: 'text-ink', label: 'text-ink-dim', ping: false },
};

function fmt(ms: number): string {
  return ms < 1 ? '<1' : String(Math.round(ms));
}

// The color key, shown at the bottom of the card. The tier that produced the
// current reading lights up; the other two dim, so the legend also answers
// "which color am I looking at right now?"
const LEGEND: { src: LatencySource; word: string }[] = [
  { src: 'lakebase', word: 'Lakebase' },
  { src: 'cache', word: 'cache' },
  { src: 'ui', word: 'fetch' },
];

export function LatencyHud() {
  const ev = useSyncExternalStore(subscribeLatency, getLatency, getLatency);
  if (!ev) return null;
  const s = STYLE[ev.source];
  const border = ev.source === 'lakebase' ? 'border-emerald-400/30' : 'border-hairline';

  return (
    <div
      className={`pointer-events-none flex w-[212px] select-none flex-col gap-1.5 rounded-xl border bg-panel/80 px-3 py-2.5 shadow-panel backdrop-blur-xl ${border}`}
    >
      {/* eyebrow: what the widget is */}
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          {s.ping && (
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${s.dot}`} />
          )}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${s.dot}`} />
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          Latency
        </span>
      </div>

      {/* the number, then which layer was hit, then the entity (if any) */}
      <div className="flex items-baseline gap-1.5">
        <motion.span
          key={ev.seq}
          initial={{ opacity: 0.3, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className={`tnum text-[22px] font-bold leading-none ${s.num}`}
        >
          {fmt(ev.ms)}
        </motion.span>
        <span className="text-[11px] text-ink-faint">ms</span>
      </div>

      <div className={`text-[9px] font-semibold uppercase tracking-wider ${s.label}`}>
        {ev.label}
      </div>

      {ev.detail && (
        <div className="tnum text-[10px] text-ink-dim">{ev.detail}</div>
      )}

      {/* color key — the active tier lights up, the other two dim */}
      <div className="mt-0.5 flex items-center justify-between border-t border-hairline/70 pt-1.5">
        {LEGEND.map(({ src, word }) => {
          const on = src === ev.source;
          const st = STYLE[src];
          return (
            <span key={src} className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${st.dot} ${on ? '' : 'opacity-30'}`} />
              <span
                className={`text-[8.5px] uppercase tracking-wide ${
                  on ? `${st.label} font-semibold` : 'text-ink-faint/60'
                }`}
              >
                {word}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
