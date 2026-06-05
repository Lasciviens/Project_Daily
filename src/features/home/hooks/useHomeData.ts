import { useQuery } from '@tanstack/react-query'
import { fetchWeather } from '../api/weatherApi'
import { fetchCurrency } from '../api/currencyApi'
import { fetchNews } from '../api/newsApi'
import { fetchDepartures, searchStops } from '../api/ruterApi'

const OSLO = { lat: 59.9139, lon: 10.7522 }

export function useWeather() {
  return useQuery({
    queryKey: ['weather', 'oslo'],
    queryFn: () => fetchWeather(OSLO.lat, OSLO.lon),
    staleTime: 10 * 60_000,
  })
}

export function useCurrency() {
  return useQuery({
    queryKey: ['currency', 'nok'],
    queryFn: () => fetchCurrency(),
    staleTime: 30 * 60_000,
  })
}

export function useNews(feedKey: string) {
  return useQuery({
    queryKey: ['news', feedKey],
    queryFn: () => fetchNews(feedKey),
    staleTime: 15 * 60_000,
  })
}

export function useDepartures(stopId: string) {
  return useQuery({
    queryKey: ['departures', stopId],
    queryFn: () => fetchDepartures(stopId),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

export function useStopSearch(query: string) {
  return useQuery({
    queryKey: ['stopSearch', query],
    queryFn: () => searchStops(query),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
  })
}
