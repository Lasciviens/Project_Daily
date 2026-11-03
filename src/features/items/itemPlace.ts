// ─────────────────────────────────────────────────────────────────────────────
//  An item's place (186; owner, 02.11.2026: "Dont we have something for entur
//  entegration? Can we use that as location finding?"). Stored on the slot or
//  the repeating plan (`time_blocks.place`, `schedule_blocks.place`); Apple
//  Calendar gets its name and map pin (the pin is what the iPhone's Time to
//  Leave works from), Google its name (calendarEventRules.eventPlace / placeText).
//
//  A place comes from EnTur's search (a stop, an address, a named place — with
//  coordinates), a saved Home/Work place, or typed text (a name, no pin). The
//  database takes only what place_ok() allows; isStorablePlace is the same rule
//  here, so the sheet never sends what the save would refuse
//  (verify-item-places compares the two; verify-db-item-places the id shape).
// ─────────────────────────────────────────────────────────────────────────────

import type { GeoPlace } from '../home/api/enturGeocoder'
import type { UserTransitStop } from '../home/api/transitStoreApi'

export interface ItemPlace {
  name: string
  locality?: string
  lat?: number
  lon?: number
  /** EnTur's id ("NSR:StopPlace:58366"): which stop or place it was — kept, never written to a calendar. */
  id?: string
}

export const PLACE_NAME_MAX = 120
export const PLACE_LOCALITY_MAX = 80
/** EnTur's ids: "NSR:StopPlace:58366", "KVE:PostalAddress:0301-…", "OSM:TopographicPlace:…" (migration 186's shape). */
export const PLACE_ID = /^[A-Za-z]{2,10}:[A-Za-z]{2,40}:[A-Za-z0-9._-]{1,80}$/
// eslint-disable-next-line no-control-regex -- control characters are exactly what is dropped
const CONTROL = /[\x00-\x1F\x7F-\x9F\u2028\u2029]/g

/** One line of text: control characters out, spaces squeezed, at most `max` characters. */
function line(t: unknown, max: number): string {
  if (typeof t !== 'string') return ''
  return Array.from(t.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim()
}

const inRange = (n: unknown, limit: number): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit

/** A place as the database stores it, or null when nothing usable is left (no name). */
export function cleanPlace(p: Partial<ItemPlace> | null | undefined): ItemPlace | null {
  const name = line(p?.name, PLACE_NAME_MAX)
  if (!name) return null
  const out: ItemPlace = { name }
  const locality = line(p?.locality, PLACE_LOCALITY_MAX)
  if (locality && locality.toLowerCase() !== name.toLowerCase()) out.locality = locality
  if (inRange(p?.lat, 90) && inRange(p?.lon, 180)) { out.lat = round6(p.lat); out.lon = round6(p.lon) }
  if (typeof p?.id === 'string' && PLACE_ID.test(p.id)) out.id = p.id
  return out
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** The database's rule (place_ok, 186) in the browser: what the sheet may send. */
export function isStorablePlace(p: unknown): p is ItemPlace {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Record<string, unknown>
  if (Object.keys(o).some(k => !['name', 'locality', 'lat', 'lon', 'id'].includes(k))) return false
  if (JSON.stringify(o).length > 400) return false
  const text = (v: unknown, max: number, needed: boolean) => v === undefined ? !needed
    : typeof v === 'string' && [...v].length <= max && !/[\x01-\x1F\x7F-\x9F\u2028\u2029]/.test(v) && (!needed || v.trim().length > 0) // eslint-disable-line no-control-regex
  if (!text(o.name, PLACE_NAME_MAX, true) || !text(o.locality, PLACE_LOCALITY_MAX, false)) return false
  if (('lat' in o) !== ('lon' in o)) return false
  if ('lat' in o && !(inRange(o.lat, 90) && inRange(o.lon, 180))) return false
  return !('id' in o) || (typeof o.id === 'string' && PLACE_ID.test(o.id))
}

/** A place from EnTur's search (a stop, an address, a named place). */
export function placeFromGeo(g: Pick<GeoPlace, 'id' | 'name' | 'locality' | 'lat' | 'lon'>): ItemPlace | null {
  return cleanPlace({ name: g.name, locality: g.locality, lat: g.lat, lon: g.lon, id: g.id })
}

/** A place typed by hand: a name, no map pin. */
export function placeFromText(text: string): ItemPlace | null {
  return cleanPlace({ name: text })
}

/** A saved Home/Work place (Settings → Places): its coordinates when it has them (an address), else none yet. */
export function placeFromSaved(s: Pick<UserTransitStop, 'stop_id' | 'stop_name' | 'stop_locality' | 'lat' | 'lon'>): ItemPlace | null {
  return cleanPlace({ name: s.stop_name, locality: s.stop_locality ?? undefined, lat: s.lat ?? undefined, lon: s.lon ?? undefined, id: s.stop_id })
}

/** "Jernbanetorget, Oslo" — how the sheet shows a place. */
export function placeLabel(p: ItemPlace): string {
  return p.locality ? `${p.name}, ${p.locality}` : p.name
}

/** Whether two places are the same one (an EnTur id, else the same name and town). */
export function samePlace(a: ItemPlace | null | undefined, b: ItemPlace | null | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a.id && b.id) return a.id === b.id
  return a.name.toLowerCase() === b.name.toLowerCase() && (a.locality ?? '').toLowerCase() === (b.locality ?? '').toLowerCase()
}

/** A stored place as the app reads it back (the column is jsonb: anything odd reads as no place). */
export function placeOfRow(raw: unknown): ItemPlace | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  return cleanPlace(raw as Partial<ItemPlace>)
}
