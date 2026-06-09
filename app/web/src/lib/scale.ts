import type { ColorMode, MapPoint } from './types';

export type RGB = [number, number, number];

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

// green (#22c55e) → amber (#f59e0b) → red (#ef4444)
const RISK_LOW: RGB = [34, 197, 94];
const RISK_MID: RGB = [245, 158, 11];
const RISK_HIGH: RGB = [239, 68, 68];

/** Map a 0..1 risk value onto the green→amber→red ramp. */
export function riskColor(t: number): RGB {
  const x = clamp01(t);
  if (x < 0.5) return lerpRGB(RISK_LOW, RISK_MID, x / 0.5);
  return lerpRGB(RISK_MID, RISK_HIGH, (x - 0.5) / 0.5);
}

export function riskCss(t: number): string {
  const [r, g, b] = riskColor(t);
  return `rgb(${r}, ${g}, ${b})`;
}

// cool→cold blue ramp for snow (slate → ice → bright cyan)
const SNOW_LOW: RGB = [51, 65, 85];
const SNOW_MID: RGB = [56, 189, 248];
const SNOW_HIGH: RGB = [191, 232, 255];

export function snowColor(t: number): RGB {
  const x = clamp01(t);
  if (x < 0.5) return lerpRGB(SNOW_LOW, SNOW_MID, x / 0.5);
  return lerpRGB(SNOW_MID, SNOW_HIGH, (x - 0.5) / 0.5);
}

// storms: deep violet → magenta → hot pink
const STORM_LOW: RGB = [76, 29, 149];
const STORM_MID: RGB = [168, 85, 247];
const STORM_HIGH: RGB = [244, 114, 182];

export function stormColor(t: number): RGB {
  const x = clamp01(t);
  if (x < 0.5) return lerpRGB(STORM_LOW, STORM_MID, x / 0.5);
  return lerpRGB(STORM_MID, STORM_HIGH, (x - 0.5) / 0.5);
}

/**
 * Normalized 0..1 metric for a point under the current color mode.
 * Domains are fixed so cross-year animation reads as real change.
 */
export function metricFor(p: MapPoint, mode: ColorMode): number {
  switch (mode) {
    case 'delay':
      // delay_rate is a fraction; ~35% delayed is "very bad"
      return clamp01((p.delay_rate ?? 0) / 0.35);
    case 'snow':
      return clamp01((p.snow_days ?? 0) / 60);
    case 'storms':
      return clamp01(((p.thunder_days ?? 0) + (p.fog_days ?? 0)) / 160);
  }
}

export function colorForMode(p: MapPoint, mode: ColorMode): RGB {
  const t = metricFor(p, mode);
  switch (mode) {
    case 'delay':
      return riskColor(t);
    case 'snow':
      return snowColor(t);
    case 'storms':
      return stormColor(t);
  }
}

/** Dot radius (meters) scales with sqrt(flights) for honest area encoding. */
export function radiusFor(flights: number): number {
  return 9000 + Math.sqrt(Math.max(flights, 0)) * 240;
}
