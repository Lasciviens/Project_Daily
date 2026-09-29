import type { UserTransitStop } from './api/transitStoreApi'

// Saved Home / Work places for Transit: a user_transit_stops row whose label
// is "Home" / "Work" (the QuaySavePanel presets). No new column — the label
// already is the name ai-proxy's plan_trip matches "home"/"work" against.

export type PlaceKind = 'home' | 'work'

export const PLACE_LABEL: Record<PlaceKind, string> = { home: 'Home', work: 'Work' }
const PLACE_WORDS: Record<PlaceKind, string[]> = {
  home: ['home', 'hjem', 'hjemme', 'ev'],
  work: ['work', 'jobb', 'jobben', 'office', 'is'],   // 'is' = İş / iş with the marks folded
}

const fold = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** The first saved stop labelled as this place (whole label, any case or accents). */
export function findPlace(stops: readonly UserTransitStop[], kind: PlaceKind): UserTransitStop | null {
  const words = PLACE_WORDS[kind]
  return stops.find(s => words.includes(fold(s.label ?? ''))) ?? null
}
