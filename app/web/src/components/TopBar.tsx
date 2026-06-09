import { num } from '../lib/format';

interface TopBarProps {
  airportCount: number;
  carrierCount: number;
  yearCount: number;
  totalFlights: number | null;
  onOpenArchitecture: () => void;
}

export function TopBar({
  airportCount,
  carrierCount,
  yearCount,
  totalFlights,
  onOpenArchitecture,
}: TopBarProps) {
  return (
    <header className="pointer-events-auto flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-panel/80 px-3 py-2.5 shadow-panel backdrop-blur-xl sm:gap-4 sm:px-5 sm:py-3">
      <button
        type="button"
        onClick={onOpenArchitecture}
        aria-label="View architecture"
        className="group flex items-center gap-3.5 rounded-xl text-left transition hover:bg-accent/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
      >
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/10 transition group-hover:border-accent/70 sm:h-9 sm:w-9">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="1.8">
            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <span className="absolute -inset-0.5 -z-10 rounded-xl bg-accent/20 blur-md transition-all duration-300 group-hover:bg-accent/40" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[13px] font-semibold leading-tight tracking-tight text-ink decoration-accent/60 decoration-[1.5px] underline-offset-[3px] group-hover:underline sm:text-[15px]">
              <span className="sm:hidden">Flight Delays</span>
              <span className="hidden sm:inline">Flight Delay Mission Control</span>
            </h1>
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent transition group-hover:border-accent/60 group-hover:shadow-glow">
              <span className="text-[10px] leading-none">✦</span>
              <span className="hidden sm:inline">View architecture</span>
              <span className="sm:hidden">Arch</span>
            </span>
          </div>
          <p className="hidden text-[11px] leading-tight text-ink-dim sm:block">
            Features computed on Databricks · served online via{' '}
            <span className="text-accent">Feast</span> over{' '}
            <span className="text-accent">Lakebase Postgres</span>
          </p>
        </div>
      </button>

      <div className="hidden items-center gap-6 sm:flex">
        <Stat value={totalFlights !== null ? num(totalFlights) : '—'} label="flights · year" />
        <Divider />
        <Stat value={String(airportCount)} label="airports" />
        <Divider />
        <Stat value={String(carrierCount)} label="carriers" />
        <Divider />
        <Stat value={String(yearCount)} label="years" />
      </div>
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-right">
      <div className="tnum text-[15px] font-semibold leading-none text-ink">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">
        {label}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-7 w-px bg-hairline" />;
}
