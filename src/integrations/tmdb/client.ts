// TMDB's v4 "API Read Access Token", sent as `Authorization: Bearer` — a key never travels in a URL (AGENTS.md → Security).
// It is still part of the public website bundle (a browser has no other place for it): TMDB's read-only token, not a secret.
const READ_TOKEN = (import.meta.env.VITE_TMDB_READ_TOKEN as string | undefined)?.trim()
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const BASE_URL = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p'

export async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!READ_TOKEN || !TOKEN_SHAPE.test(READ_TOKEN)) throw new Error('VITE_TMDB_READ_TOKEN is not set (or is not TMDB\'s "API Read Access Token") — see docs/deploy-checklist.md, "TMDB read token"')
  const url = new URL(`${BASE_URL}${path}`)
  url.searchParams.set('language', 'en-US')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${READ_TOKEN}`, Accept: 'application/json' } })
  if (res.status === 401) throw new Error('TMDB rejected the app\'s read token (VITE_TMDB_READ_TOKEN). Put a valid TMDB API Read Access Token in the GitHub secret and redeploy.')
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export const posterUrl = (path: string | null, size = 'w342'): string =>
  path ? `${IMAGE_BASE}/${size}${path}` : '/placeholder-poster.png'

export const tmdbMovieUrl = (tmdbId: number) => `https://www.themoviedb.org/movie/${tmdbId}`
export const tmdbTVUrl    = (tmdbId: number) => `https://www.themoviedb.org/tv/${tmdbId}`
