import { motion } from 'framer-motion';
import type { CarrierStat } from '../lib/types';
import { riskCss } from '../lib/scale';
import { mins, pct } from '../lib/format';

export function CarrierLeaderboard({ carriers }: { carriers: CarrierStat[] }) {
  // best on-time at top → sort by ontime_pct desc (fallback to avg_delay)
  const ranked = [...carriers].sort(
    (a, b) => (b.ontime_pct ?? 0) - (a.ontime_pct ?? 0),
  );
  const maxOntime = Math.max(...ranked.map((c) => c.ontime_pct ?? 0), 0.01);

  return (
    <div className="space-y-1.5">
      {ranked.map((c, i) => {
        const ontime = c.ontime_pct ?? 0;
        const w = (ontime / maxOntime) * 100;
        // color by delay-risk ramp: lower delay_rate = greener
        const risk = Math.min(1, (c.delay_rate ?? 0) / 0.35);
        return (
          <div key={c.code} className="group relative">
            <div className="relative flex items-center gap-2.5 overflow-hidden rounded-lg border border-hairline/60 bg-panel-2/50 px-2.5 py-1.5">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-lg opacity-20"
                style={{ background: riskCss(risk) }}
                initial={{ width: 0 }}
                animate={{ width: `${w}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 28 }}
              />
              <span className="tnum relative z-10 w-4 shrink-0 text-[10px] font-semibold text-ink-faint">
                {i + 1}
              </span>
              <span
                className="relative z-10 h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: riskCss(risk),
                  boxShadow: `0 0 8px ${riskCss(risk)}`,
                }}
              />
              <span className="relative z-10 min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                {c.name}
              </span>
              <span className="tnum relative z-10 w-12 shrink-0 text-right text-[12px] font-semibold text-ink">
                {pct(c.ontime_pct)}
              </span>
              <span className="tnum relative z-10 w-12 shrink-0 text-right text-[11px] text-ink-dim">
                {mins(c.avg_delay)}
              </span>
            </div>
          </div>
        );
      })}
      <div className="flex justify-end gap-[3.25rem] px-2.5 pt-1 text-[9px] uppercase tracking-wider text-ink-faint">
        <span>on-time</span>
        <span>avg delay</span>
      </div>
    </div>
  );
}
