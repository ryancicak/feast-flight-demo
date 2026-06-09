import type {
  AirportTrend,
  CarrierStat,
  MapPoint,
  Meta,
  ScoreResult,
} from './types';
import { recordLatency } from './telemetry';

async function getJSON<T>(url: string, label: string): Promise<T> {
  const t0 = performance.now();
  const res = await fetch(url);
  const clientMs = performance.now() - t0;
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const data = (await res.json()) as T;
  // Prefer the server's own processing time (X-Server-Ms) so the reading
  // reflects server work, not the viewer's network. Fall back to the client
  // round trip if the header is absent.
  const serverMs = Number(res.headers.get('X-Server-Ms'));
  const ms = Number.isFinite(serverMs) && serverMs > 0 ? serverMs : clientMs;
  recordLatency({ source: 'ui', ms, label });
  return data;
}

export const fetchMeta = () => getJSON<Meta>('/api/meta', 'metadata');

export const fetchMap = (year: number) =>
  getJSON<MapPoint[]>(`/api/map/${year}`, `map · ${year}`);

export const fetchCarriers = (year: number) =>
  getJSON<CarrierStat[]>(`/api/carriers/${year}`, `leaderboard · ${year}`);

export const fetchTrend = (code: string) =>
  getJSON<AirportTrend>(`/api/airport/${code}/trend`, `airport · ${code}`);

export async function scoreFlight(body: {
  origin: string;
  dest: string;
  carrier: string;
  year: number;
}): Promise<ScoreResult> {
  const t0 = performance.now();
  const res = await fetch('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const roundTripMs = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`/api/score → ${res.status}`);
  const data = (await res.json()) as ScoreResult;
  // Headline the server-measured Lakebase read when present; fall back to the
  // browser round trip if the backend didn't report one.
  recordLatency({
    source: 'lakebase',
    ms: Math.round(data.latency_ms ?? roundTripMs),
    label: 'Lakebase online lookup',
    detail: `${body.origin} → ${body.dest} · ${body.year}`,
  });
  return data;
}
