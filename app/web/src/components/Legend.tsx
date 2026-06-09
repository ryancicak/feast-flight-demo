import type { ColorMode } from '../lib/types';
import { snowColor, stormColor, riskColor, type RGB } from '../lib/scale';

const RAMPS: Record<
  ColorMode,
  { fn: (t: number) => RGB; lo: string; hi: string; unit: string }
> = {
  delay: { fn: riskColor, lo: '0%', hi: '35%+', unit: 'flights delayed 15m+' },
  snow: { fn: snowColor, lo: '0', hi: '60+', unit: 'snow days / yr' },
  storms: { fn: stormColor, lo: '0', hi: '160+', unit: 'fog + thunder days' },
};

export function Legend({ mode }: { mode: ColorMode }) {
  const ramp = RAMPS[mode];
  const stops = Array.from({ length: 7 }, (_, i) => {
    const [r, g, b] = ramp.fn(i / 6);
    return `rgb(${r},${g},${b}) ${(i / 6) * 100}%`;
  }).join(', ');

  return (
    <div className="pointer-events-auto rounded-xl border border-hairline bg-panel/80 px-3 py-2 shadow-panel backdrop-blur-md">
      <div className="text-[9px] uppercase tracking-[0.16em] text-ink-faint">
        {ramp.unit}
      </div>
      <div
        className="mt-1.5 h-2 w-40 rounded-full"
        style={{ background: `linear-gradient(90deg, ${stops})` }}
      />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-dim">
        <span>{ramp.lo}</span>
        <span>{ramp.hi}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-faint">
        <span className="inline-block h-2.5 w-2.5 rounded-full border border-ink-faint/60" />
        dot size ∝ flight volume
      </div>
    </div>
  );
}
