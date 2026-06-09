import { AnimatePresence, motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTrend } from '../hooks/useData';
import type { MapPoint } from '../lib/types';
import { mins, num, pct } from '../lib/format';

interface AirportPanelProps {
  code: string | null;
  year: number;
  point: MapPoint | undefined;
  onClose: () => void;
  onUseAsOrigin: (code: string) => void;
  onUseAsDest: (code: string) => void;
  isOrigin: boolean;
  isDest: boolean;
}

export function AirportPanel({
  code,
  year,
  point,
  onClose,
  onUseAsOrigin,
  onUseAsDest,
  isOrigin,
  isDest,
}: AirportPanelProps) {
  const { data, isLoading } = useTrend(code);

  return (
    <AnimatePresence>
      {code && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="pointer-events-auto w-[440px] overflow-hidden rounded-2xl border border-hairline bg-panel/95 shadow-panel backdrop-blur-xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-hairline/70 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="tnum text-lg font-bold text-accent">
                  {code}
                </span>
                <span className="rounded-full border border-hairline bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
                  20-year trend
                </span>
              </div>
              <div className="truncate text-[12px] text-ink-dim">
                {data?.name ?? point?.name ?? ''}
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md border border-hairline bg-panel-2 p-1.5 text-ink-faint transition hover:text-ink"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="px-4 py-3">
            {/* one click: put this airport into the score and re-run it */}
            <div className="mb-3 flex gap-2">
              <QuickScoreButton
                label={isOrigin ? 'Origin' : 'Score as origin'}
                active={isOrigin}
                onClick={() => onUseAsOrigin(code)}
              />
              <QuickScoreButton
                label={isDest ? 'Destination' : 'Score as destination'}
                active={isDest}
                onClick={() => onUseAsDest(code)}
              />
            </div>

            {/* selected-year stats */}
            {point && (
              <div className="mb-3 grid grid-cols-3 gap-2">
                <YearStat label={`${year} flights`} value={num(point.flights)} />
                <YearStat label="% delayed" value={pct(point.delay_rate, 1)} />
                <YearStat label="avg delay" value={mins(point.avg_delay)} />
              </div>
            )}

            {/* trend chart */}
            <div className="h-44 w-full">
              {isLoading || !data ? (
                <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
                  Loading trend…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.series}
                    margin={{ top: 6, right: 6, left: -22, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="delayFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.42} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" vertical={false} />
                    <XAxis
                      dataKey="year"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      tickLine={false}
                      axisLine={{ stroke: '#1e293b' }}
                      ticks={[1987, 1992, 1997, 2002, 2008]}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={42}
                      tickFormatter={(v) => `${v}m`}
                    />
                    <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#38bdf8', strokeWidth: 1, strokeOpacity: 0.4 }} />
                    <ReferenceLine x={year} stroke="#38bdf8" strokeDasharray="3 3" strokeOpacity={0.7} />
                    <Area
                      type="monotone"
                      dataKey="avg_delay"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      fill="url(#delayFill)"
                      dot={false}
                      activeDot={{ r: 3, fill: '#38bdf8' }}
                      isAnimationActive
                    />
                    <Line
                      type="monotone"
                      dataKey="snow_days"
                      stroke="#7dd3fc"
                      strokeWidth={1.2}
                      strokeOpacity={0.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-1 flex items-center gap-4 text-[10px] text-ink-faint">
              <Legend color="#38bdf8" label="avg arrival delay (min)" />
              <Legend color="#7dd3fc" label="snow days" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QuickScoreButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-semibold transition ${
        active
          ? 'border-accent/60 bg-accent/15 text-accent'
          : 'border-hairline bg-panel-2 text-ink-dim hover:border-accent/40 hover:text-accent'
      }`}
    >
      {active && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
      {label}
    </button>
  );
}

function YearStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline/70 bg-panel-2/60 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      <div className="tnum text-[15px] font-semibold text-ink">{value}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

interface TooltipPayload {
  payload: { year: number; avg_delay: number | null; delay_rate: number | null; flights: number; snow_days: number | null };
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-hairline bg-panel px-3 py-2 shadow-panel">
      <div className="tnum text-[12px] font-bold text-ink">{d.year}</div>
      <div className="tnum text-[11px] text-ink-dim">
        avg delay {mins(d.avg_delay)} · {pct(d.delay_rate)} late
      </div>
      <div className="tnum text-[11px] text-ink-faint">
        {num(d.flights)} flights · {d.snow_days ?? '—'} snow days
      </div>
    </div>
  );
}
