import { AnimatePresence, motion } from 'framer-motion';
import type { ScoreResult } from '../lib/types';
import { riskColor } from '../lib/scale';
import { mins } from '../lib/format';

// Horizontal strip of the same flight scored across different years. The first
// pinned year is the baseline; the rest show their risk delta against it. Every
// card was a live Lakebase lookup, which is the whole point of year being part
// of the entity key.
export function CompareDock({
  items,
  onClear,
  onPick,
}: {
  items: ScoreResult[];
  onClear: () => void;
  onPick?: (year: number) => void;
}) {
  if (!items.length) return null;
  const base = items[0];
  const baseRisk = base.blended_delay_risk ?? 0;
  const route = `${base.airport_id} → ${base.route_id.split('-')[1]}`;

  return (
    <div className="pointer-events-auto rounded-2xl border border-hairline bg-panel/85 px-3 py-2.5 shadow-panel backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Comparing{' '}
          <span className="tnum text-ink-dim">{route}</span> ·{' '}
          <span className="text-ink-dim">{base.carrier_name}</span>
        </div>
        <button
          onClick={onClear}
          className="rounded-md border border-hairline bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint transition hover:border-accent/40 hover:text-ink"
        >
          Clear
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <AnimatePresence mode="popLayout">
          {items.map((it) => {
            const risk = it.blended_delay_risk ?? 0;
            const [r, g, b] = riskColor(Math.min(1, risk / 0.35));
            const color = `rgb(${r}, ${g}, ${b})`;
            const isBase = it.year === base.year;
            const deltaPP = Math.round((risk - baseRisk) * 100);
            return (
              <motion.button
                key={it.year}
                layout
                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                onClick={() => onPick?.(it.year)}
                className="w-[112px] shrink-0 rounded-xl border border-hairline bg-panel-2/70 px-3 py-2 text-left transition hover:border-accent/40"
              >
                <div className="tnum text-[15px] font-bold leading-none text-ink">
                  {it.year}
                </div>
                <div
                  className="tnum mt-1.5 text-[22px] font-bold leading-none"
                  style={{ color }}
                >
                  {Math.round(risk * 100)}%
                </div>
                <div className="tnum mt-1 text-[11px] text-ink-dim">
                  {mins(it.origin_avg_arr_delay)} origin
                </div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider">
                  {isBase ? (
                    <span className="text-ink-faint">baseline</span>
                  ) : (
                    <span
                      className={
                        deltaPP > 0
                          ? 'text-risk-high'
                          : deltaPP < 0
                            ? 'text-risk-low'
                            : 'text-ink-faint'
                      }
                    >
                      {deltaPP > 0 ? '+' : ''}
                      {deltaPP}pp vs {base.year}
                    </span>
                  )}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
