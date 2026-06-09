import { useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface YearScrubberProps {
  years: number[];
  year: number;
  onChange: (year: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}

export function YearScrubber({
  years,
  year,
  onChange,
  playing,
  onTogglePlay,
}: YearScrubberProps) {
  const min = years[0];
  const max = years[years.length - 1];
  const idx = years.indexOf(year);
  const frac = (year - min) / (max - min || 1);
  const trackRef = useRef<HTMLDivElement>(null);

  // playback loop — a calm "few seconds per year" cadence so you can read each year
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      onChange(year >= max ? min : year + 1);
    }, 2500);
    return () => clearInterval(id);
  }, [playing, year, min, max, onChange]);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onChange(Math.round(min + t * (max - min)));
    },
    [min, max, onChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 1) setFromClientX(e.clientX);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onChange(Math.max(min, year - 1));
    if (e.key === 'ArrowRight') onChange(Math.min(max, year + 1));
  };

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-hairline bg-panel/85 px-3 py-2.5 shadow-panel backdrop-blur-xl sm:gap-5 sm:px-5 sm:py-4">
      {/* Play / pause */}
      <button
        onClick={onTogglePlay}
        className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent transition hover:bg-accent/20 hover:shadow-glow sm:h-12 sm:w-12"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="3" y="2" width="3.5" height="12" rx="1" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.5v11a1 1 0 0 0 1.5.87l9-5.5a1 1 0 0 0 0-1.74l-9-5.5A1 1 0 0 0 4 2.5Z" />
          </svg>
        )}
      </button>

      {/* big readout */}
      <div className="w-[64px] shrink-0 sm:w-[120px]">
        <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-faint sm:text-[10px] sm:tracking-[0.2em]">
          Flight year
        </div>
        <div className="tnum glow-text -mt-1 text-3xl font-bold leading-none tracking-tight text-ink sm:text-5xl">
          {year}
        </div>
      </div>

      {/* timeline */}
      <div className="relative flex-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={year}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          className="group relative h-10 cursor-pointer select-none outline-none"
        >
          {/* base track */}
          <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-hairline" />
          {/* filled track */}
          <motion.div
            className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-accent/40 to-accent"
            animate={{ width: `${frac * 100}%` }}
            transition={{ type: 'spring', stiffness: 240, damping: 30 }}
          />
          {/* ticks */}
          {years.map((y, i) => {
            const t = (y - min) / (max - min || 1);
            const major = y % 5 === 0;
            return (
              <div
                key={y}
                className={`absolute top-1/2 w-px -translate-y-1/2 ${
                  i <= idx ? 'bg-accent/60' : 'bg-ink-faint/40'
                }`}
                style={{
                  left: `${t * 100}%`,
                  height: major ? 14 : 7,
                  marginTop: major ? -7 : -3.5,
                }}
              />
            );
          })}
          {/* handle */}
          <motion.div
            className="absolute top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-accent bg-base shadow-glow"
            animate={{ left: `${frac * 100}%` }}
            transition={{ type: 'spring', stiffness: 240, damping: 30 }}
          >
            <div className="h-2 w-2 rounded-full bg-accent" />
          </motion.div>
        </div>
        {/* end labels */}
        <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-ink-faint">
          <span>{min}</span>
          <span className="hidden text-ink-dim sm:inline">
            {years.length} years of US domestic flights
          </span>
          <span>{max}</span>
        </div>
      </div>
    </div>
  );
}
