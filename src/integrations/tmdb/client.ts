const API_KEY  = import.meta.env.VITE_TMDB_API_KEY as string
const BASE_URL = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p'

if (!API_KEY) throw new Error('VITE_TMDB_API_KEY is not set')

export async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('language', 'en-US')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export const posterUrl = (path: string | null, size = 'w342'): string =>
  path ? `${IMAGE_BASE}/${size}${path}` : '/placeholder-poster.png'

export const backdropUrl = (path: string | null, size = 'w780'): string =>
  path ? `${IMAGE_BASE}/${size}${path}` : ''

export const tmdbMovieUrl = (tmdbId: number) => `https://www.themoviedb.org/movie/${tmdbId}`
export const tmdbTVUrl    = (tmdbId: number) => `https://www.themoviedb.org/tv/${tmdbId}`
