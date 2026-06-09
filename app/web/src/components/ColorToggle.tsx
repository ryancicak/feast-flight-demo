import { motion } from 'framer-motion';
import type { ColorMode } from '../lib/types';

const MODES: { id: ColorMode; label: string }[] = [
  { id: 'delay', label: 'Delay risk' },
  { id: 'snow', label: 'Snow' },
  { id: 'storms', label: 'Storms' },
];

export function ColorToggle({
  mode,
  onChange,
}: {
  mode: ColorMode;
  onChange: (m: ColorMode) => void;
}) {
  return (
    <div className="flex rounded-lg border border-hairline bg-panel-2 p-0.5">
      {MODES.map((m) => {
        const active = m.id === mode;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={`relative rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
              active ? 'text-base' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {active && (
              <motion.div
                layoutId="color-toggle-pill"
                className="absolute inset-0 rounded-md bg-accent"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative z-10">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
