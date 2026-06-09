import { motion } from 'framer-motion';
import { riskColor } from '../lib/scale';

/** Big radial gauge for a 0..1 risk value, colored on the green→amber→red ramp. */
export function RiskGauge({ value }: { value: number | null }) {
  const v = value ?? 0;
  const size = 168;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // 270° arc starting bottom-left
  const startAngle = 135;
  const sweep = 270;
  const circumference = 2 * Math.PI * r;
  const arcLen = (sweep / 360) * circumference;
  const gapLen = circumference - arcLen;

  const [cr, cg, cb] = riskColor(v);
  const color = `rgb(${cr}, ${cg}, ${cb})`;
  const dash = arcLen * v;

  const label = v < 0.18 ? 'Low' : v < 0.3 ? 'Moderate' : v < 0.42 ? 'Elevated' : 'High';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[0deg]">
        <g transform={`rotate(${startAngle} ${cx} ${cy})`}>
          {/* track */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#1e293b"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${gapLen}`}
          />
          {/* value arc */}
          <motion.circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${circumference}`}
            initial={false}
            animate={{ strokeDashoffset: arcLen - dash }}
            transition={{ type: 'spring', stiffness: 110, damping: 20 }}
            style={{ filter: `drop-shadow(0 0 10px ${color}88)` }}
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          key={Math.round(v * 1000)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="tnum text-4xl font-bold leading-none text-ink"
          style={{ color }}
        >
          {value === null ? '—' : `${Math.round(v * 100)}%`}
        </motion.div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
          {value === null ? 'no data' : label} risk
        </div>
      </div>
    </div>
  );
}
