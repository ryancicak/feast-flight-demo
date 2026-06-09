import { useEffect } from 'react';
import { motion } from 'framer-motion';

/**
 * Full-screen architecture view — deliberately simple: three big stages with
 * data visibly flowing left→right, then one punchy line about the online-store swap.
 * Databricks red-orange for the lakehouse, cyan for the serving side.
 */

const DBX = '#FF3621';
const CYAN = '#38bdf8';

interface Stage {
  title: string;
  stat: string;
  label: string;
  accent: string;
  hero?: boolean;
  glyph: JSX.Element;
}

const STAGES: Stage[] = [
  {
    title: 'Databricks Lakehouse',
    stat: '859M',
    label: 'raw rows aggregated',
    accent: DBX,
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
        <path d="M3 12l9 4.5L21 12" />
        <path d="M3 16.5 12 21l9-4.5" opacity="0.5" />
      </svg>
    ),
  },
  {
    title: 'Feast',
    stat: '413 KB',
    label: '20-year feature tables',
    accent: CYAN,
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.5 4 6v6c0 4.6 3.4 7.6 8 9.5 4.6-1.9 8-4.9 8-9.5V6l-8-3.5Z" />
        <path d="m8.5 12 2.4 2.4L15.8 9.5" />
      </svg>
    ),
  },
  {
    title: 'Lakebase Postgres',
    stat: '< 10 ms',
    label: 'in-region key lookup',
    accent: CYAN,
    hero: true,
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 4.5 13h6L11 22l8.5-11h-6L13 2Z" />
      </svg>
    ),
  },
];

const INCUMBENTS = ['Redis', 'DynamoDB', 'Bigtable', 'Cassandra'];

export function ArchitectureModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      key="arch-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4 backdrop-blur-md sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Architecture"
    >
      <motion.div
        key="arch-card"
        initial={{ opacity: 0, scale: 0.965, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[1000px] overflow-hidden rounded-3xl border border-hairline bg-panel/95 px-7 py-8 shadow-panel backdrop-blur-2xl sm:px-10 sm:py-10"
      >
        {/* ambient glow: red on the left (lakehouse), cyan on the right (serving) */}
        <div
          className="pointer-events-none absolute -inset-px -z-10 rounded-3xl"
          style={{
            background:
              'radial-gradient(60% 70% at 12% 10%, rgba(255,54,33,0.12), transparent 60%), radial-gradient(60% 80% at 92% 90%, rgba(56,189,248,0.16), transparent 60%)',
          }}
        />

        {/* close */}
        <button
          onClick={onClose}
          aria-label="Close architecture"
          className="absolute right-5 top-5 rounded-lg border border-hairline bg-panel-2 p-2 text-ink-faint transition hover:border-accent/40 hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" strokeLinecap="round" />
          </svg>
        </button>

        {/* headline */}
        <div className="mb-9 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-ink-faint">
            How it works
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
            From lakehouse to{' '}
            <span className="glow-text text-accent">live serving</span>
          </h2>
        </div>

        {/* three big stages with flowing connectors */}
        <div className="relative grid grid-cols-1 gap-5 md:grid-cols-3">
          <FlowRail />
          {STAGES.map((s, i) => (
            <StageCard key={s.title} stage={s} index={i} />
          ))}
        </div>

        {/* one punchy line about the swap */}
        <SwapLine />
      </motion.div>
    </motion.div>
  );
}

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const { accent, hero } = stage;
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.12, type: 'spring', stiffness: 230, damping: 24 }}
      className="relative z-10 flex flex-col items-center rounded-2xl border bg-panel-2/85 px-5 py-6 text-center backdrop-blur-sm"
      style={{
        borderColor: hero ? `${accent}66` : 'rgba(30,41,59,1)',
        boxShadow: hero ? `0 0 34px ${accent}33` : undefined,
      }}
    >
      {/* big glyph chip */}
      <div
        className="relative flex h-14 w-14 items-center justify-center rounded-2xl border"
        style={{ borderColor: `${accent}55`, background: `${accent}14`, color: accent }}
      >
        <span className="h-7 w-7">{stage.glyph}</span>
        <motion.span
          className="absolute -inset-1 -z-10 rounded-2xl blur-lg"
          style={{ background: `${accent}33` }}
          animate={{ opacity: hero ? [0.5, 0.9, 0.5] : [0.3, 0.55, 0.3] }}
          transition={{ duration: hero ? 2 : 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-ink">
        {stage.title}
      </h3>
      <div
        className="tnum mt-2 text-[32px] font-bold leading-none tracking-tight"
        style={{ color: accent, textShadow: hero ? `0 0 24px ${accent}66` : undefined }}
      >
        {stage.stat}
      </div>
      <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
        {stage.label}
      </div>
    </motion.div>
  );
}

/** Glowing rail with data packets flowing left→right behind the three stages (md+). */
function FlowRail() {
  const centers = STAGES.map((_, i) => ((i + 0.5) / STAGES.length) * 100);
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 top-1/2 -z-0 hidden h-16 -translate-y-1/2 md:block"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="archRail" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={DBX} stopOpacity="0.6" />
          <stop offset="50%" stopColor={DBX} stopOpacity="0.4" />
          <stop offset="60%" stopColor={CYAN} stopOpacity="0.5" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0.65" />
        </linearGradient>
        <filter id="archGlow" x="-20%" y="-300%" width="140%" height="700%">
          <feGaussianBlur stdDeviation="0.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <line
        x1={centers[0]} y1="5" x2={centers[centers.length - 1]} y2="5"
        stroke="url(#archRail)" strokeWidth="0.4" strokeLinecap="round" filter="url(#archGlow)"
      />
      {centers.slice(0, -1).map((from, i) => (
        <motion.circle
          key={i}
          cy="5" r="0.7"
          fill={i === 0 ? DBX : CYAN}
          filter="url(#archGlow)"
          initial={{ cx: from, opacity: 0 }}
          animate={{ cx: [from, centers[i + 1]], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.5, delay: i * 0.8 }}
        />
      ))}
    </svg>
  );
}

function SwapLine() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, type: 'spring', stiffness: 220, damping: 26 }}
      className="mt-9 rounded-2xl border border-accent/30 bg-panel-2/70 px-6 py-5 text-center"
    >
      <h3 className="text-[17px] font-semibold tracking-tight text-ink">
        Your online store is a <span className="glow-text text-accent">pluggable backend</span>
      </h3>
      <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 text-[12px]">
        {INCUMBENTS.map((name) => (
          <span key={name} className="rounded-md border border-hairline bg-panel px-2.5 py-1 text-ink-faint line-through decoration-risk-high/70 decoration-[1.5px]">
            {name}
          </span>
        ))}
        <span className="mx-0.5 text-ink-faint">→</span>
        <span
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1 font-semibold text-accent"
          style={{ boxShadow: `0 0 16px ${CYAN}33` }}
        >
          Lakebase ✓
        </span>
      </div>
      <p className="mx-auto mt-3.5 max-w-[30rem] text-[12px] leading-relaxed text-ink-dim">
        Switching is one block of{' '}
        <code className="rounded bg-panel px-1 py-0.5 text-[11px] text-accent">feature_store.yaml</code>.
        Feature views, point-in-time training, and serving code stay exactly the same.
      </p>
    </motion.div>
  );
}
