// ─────────────────────────────────────────────────────────────────────────────
//  The phone's time zone, and how an item's zone is shown (183 — the owner,
//  31.10.2026: "Time zones should be based on location … you can make a smart
//  way to do it"; docs/features/calendar-plan.md → Time zones from the phone).
//  No location is needed: the phone's clock already uses its zone. Pure apart
//  from reading that zone (scripts/verify-time-zones.cjs runs it).
// ─────────────────────────────────────────────────────────────────────────────

import { itemTimeZone } from '../../features/calendar/calendarEventRules'

/**
 * Old zone names a browser may still report (its zone library keeps some as their main name) → today's names, which
 * every server knows: a Postgres without its old links refuses "Asia/Calcutta" but takes "Asia/Kolkata". Any other
 * name goes as the phone gives it; one a server doesn't know leaves the item in the home zone, which the app shows.
 */
const CURRENT_NAMES: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
}

/** A zone name as today's tzdata names it (the old names above), else as given. */
export function currentZoneName(zone: string): string {
  return CURRENT_NAMES[zone] ?? zone
}

/** The zone the phone's clock is in, by today's name — or null when it names none a server could take. */
export function phoneTimeZone(): string | null {
  let zone: string | undefined
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return null }
  if (!zone) return null
  const current = currentZoneName(zone)
  return itemTimeZone(current) === current ? current : null
}

const offsetClocks = new Map<string, Intl.DateTimeFormat>()
/** `zone`'s UTC offset at `t` in minutes. */
function offsetAt(zone: string, t: number): number {
  let clock = offsetClocks.get(zone)
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    offsetClocks.set(zone, clock)
  }
  const p = Object.fromEntries(clock.formatToParts(new Date(t)).map(x => [x.type, x.value]))
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / 60_000) * 60_000) / 60_000)
}

const sameClocks = new Map<string, boolean>()
/** Two zones that keep the same clock this year (Oslo and Stockholm, summer time included) — the same time to a person. */
export function sameClock(a: string, b: string, now: number = Date.now()): boolean {
  if (a === b) return true
  const key = `${a}|${b}|${new Date(now).getUTCFullYear()}`
  let same = sameClocks.get(key)
  if (same === undefined) {
    const year = new Date(now).getUTCFullYear()
    // Mid-month instants all year: any difference in rules shows in at least one.
    same = Array.from({ length: 12 }, (_, m) => Date.UTC(year, m, 15, 12)).every(t => offsetAt(a, t) === offsetAt(b, t))
    sameClocks.set(key, same)
  }
  return same
}

/** A zone for people: its place ("Europe/Istanbul" → "Istanbul", "America/Argentina/Buenos_Aires" → "Buenos Aires"),
 *  or its offset for one without a place ("Etc/GMT+1" → "GMT-1", "UTC" → "UTC"). */
export function zoneCity(zone: string): string {
  const z = itemTimeZone(zone)
  if (z === 'UTC' || z.startsWith('Etc/')) {
    try {
      const name = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value
      if (name) return /^GMT([+-]0)?$/.test(name) ? 'UTC' : name
    } catch { /* fall through to the name */ }
  }
  return (z.split('/').pop() ?? z).replace(/_/g, ' ')
}

/**
 * What an item's time says about its zone: nothing when it keeps the phone's clock (the usual case), else the place
 * whose time it is ("Oslo") — so "17:00" never silently means two things. A missing or unknown zone is the home zone.
 */
export function zoneTag(zone: string | null | undefined, phone: string | null = phoneTimeZone(), now: number = Date.now()): string | null {
  const z = itemTimeZone(zone)
  if (!phone || sameClock(z, phone, now)) return null
  return zoneCity(z)
}
