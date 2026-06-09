import { useQuery } from '@tanstack/react-query';
import {
  fetchCarriers,
  fetchMap,
  fetchMeta,
  fetchTrend,
} from '../lib/api';

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: fetchMeta,
    staleTime: Infinity, // meta never changes for a session
  });
}

export function useMap(year: number) {
  return useQuery({
    queryKey: ['map', year],
    queryFn: () => fetchMap(year),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev, // keep last year's dots while the next loads
  });
}

export function useCarriers(year: number) {
  return useQuery({
    queryKey: ['carriers', year],
    queryFn: () => fetchCarriers(year),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useTrend(code: string | null) {
  return useQuery({
    queryKey: ['trend', code],
    queryFn: () => fetchTrend(code as string),
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  });
}
