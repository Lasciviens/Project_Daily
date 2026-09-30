import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Per-device Media conveniences (localStorage `lasci.mediaPrefs`): the
// streaming services Discover's "My services" tab filters by, and the
// "What to watch?" length limit, and the genres / languages Discover never shows.
interface MediaPrefs {
  services: number[]
  tonightMax: 0 | 90 | 120
  hideGenres: { movie: number[]; tv: number[] }
  hideLanguages: string[]
  toggleService: (id: number) => void
  setTonightMax: (m: 0 | 90 | 120) => void
  setHidden: (type: 'movie' | 'tv', genres: number[], languages: string[]) => void
}

export const useMediaPrefs = create<MediaPrefs>()(persist(set => ({
  services: [],
  tonightMax: 0,
  hideGenres: { movie: [], tv: [] },
  hideLanguages: [],
  setHidden: (type, genres, languages) => set(s => ({ hideGenres: { ...s.hideGenres, [type]: genres }, hideLanguages: languages })),
  toggleService: id => set(s => ({ services: s.services.includes(id) ? s.services.filter(x => x !== id) : [...s.services, id] })),
  setTonightMax: m => set({ tonightMax: m }),
}), {
  name: 'lasci.mediaPrefs',
  version: 2,
  migrate: (old, v) => (v < 2 ? { ...(old as object), hideGenres: { movie: [], tv: [] }, hideLanguages: [] } : old) as MediaPrefs,
}))
