// A tiny pub/sub for the most recent API latency, read by the LatencyHud via
// useSyncExternalStore. Kept out of react-query/component state on purpose: any
// call site (the score mutation, the prefetch loop, an airport click) can push
// a reading without threading props through the tree.
//
// Three kinds of reading, so one widget tells the whole latency story:
//   lakebase - a real online feature lookup (the /api/score round trip). We show
//              the SERVER-measured number (the Feast -> Lakebase Postgres read),
//              so it reflects the store's speed, not the viewer's home wifi.
//   cache    - a year scrub / Play step served from the prefetched react-query
//              cache. No network: this is the "<1 ms, it's in memory" tier, and
//              the reason scrubbing is instant.
//   ui       - a cold data fetch off the offline parquet (map / leaderboard /
//              trend / metadata) before it is cached. Client round trip.
export type LatencySource = 'lakebase' | 'cache' | 'ui';

export interface LatencyReading {
  source: LatencySource;
  ms: number;
  label: string;
  detail?: string;
  seq: number;
}

let current: LatencyReading | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function recordLatency(r: Omit<LatencyReading, 'seq'>): void {
  current = { ...r, seq: ++seq };
  listeners.forEach((fn) => fn());
}

export function subscribeLatency(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLatency(): LatencyReading | null {
  return current;
}
