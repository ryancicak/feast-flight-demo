export interface Airport {
  code: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

export interface Carrier {
  code: string;
  name: string;
}

export interface Meta {
  years: number[];
  airports: Airport[];
  carriers: Carrier[];
}

export interface MapPoint {
  code: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  flights: number;
  avg_delay: number | null;
  delay_rate: number | null;
  snow_days: number | null;
  precip_days: number | null;
  fog_days: number | null;
  thunder_days: number | null;
  tmax: number | null;
}

export interface CarrierStat {
  code: string;
  name: string;
  flights: number;
  avg_delay: number | null;
  delay_rate: number | null;
  ontime_pct: number | null;
}

export interface TrendPoint {
  year: number;
  avg_delay: number | null;
  delay_rate: number | null;
  flights: number;
  snow_days: number | null;
  fog_days: number | null;
}

export interface AirportTrend {
  code: string;
  name: string;
  series: TrendPoint[];
}

export interface ScoreResult {
  carrier_name: string;
  year: number;
  airport_id: string;
  carrier_id: string;
  route_id: string;
  origin_avg_arr_delay: number | null;
  origin_delay_rate_15: number | null;
  origin_flights: number | null;
  carrier_avg_arr_delay: number | null;
  carrier_ontime_pct: number | null;
  carrier_delay_rate_15: number | null;
  route_avg_arr_delay: number | null;
  route_delay_rate_15: number | null;
  route_distance: number | null;
  route_flights: number | null;
  origin_avg_distance: number | null;
  origin_avg_elapsed_min: number | null;
  wx_avg_tmax_c: number | null;
  wx_avg_tmin_c: number | null;
  wx_avg_wind_ms: number | null;
  wx_snow_days: number | null;
  wx_fog_days: number | null;
  wx_thunder_days: number | null;
  wx_precip_days: number | null;
  wx_total_precip_mm: number | null;
  wx_total_snow_mm: number | null;
  blended_delay_risk: number | null;
  latency_ms: number | null;
  mode?: string;
  [key: string]: unknown;
}

export type ColorMode = 'delay' | 'snow' | 'storms';

// The flight drawn on the map after a score: origin -> dest great arc, colored
// by the blended delay risk, with the two airports kept lit while the rest of
// the field fades back.
export interface ScoredArc {
  from: [number, number]; // [lon, lat]
  to: [number, number];
  origin: string;
  dest: string;
  risk: number | null;
}
