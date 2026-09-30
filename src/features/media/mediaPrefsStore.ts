import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Per-device Media conveniences (localStorage `lasci.mediaPrefs`): the
// streaming services Discover's "My services" tab filters by, and the
// "What to watch?" length limit.
interface MediaPrefs {
  services: number[]
  tonightMax: 0 | 90 | 120
  toggleService: (id: number) => void
  setTonightMax: (m: 0 | 90 | 120) => void
}

export const useMediaPrefs = create<MediaPrefs>()(persist(set => ({
  services: [],
  tonightMax: 0,
  toggleService: id => set(s => ({ services: s.services.includes(id) ? s.services.filter(x => x !== id) : [...s.services, id] })),
  setTonightMax: m => set({ tonightMax: m }),
}), { name: 'lasci.mediaPrefs', version: 1 }))
