// KOReader's AutoWarmth plugin (plugins/autowarmth.koplugin/main.lua, v2026.07.1)
// in the app's words — pure, verified by scripts/verify-kobo-settings.cjs.
//
// autowarmth_scheduler_times: 11 decimal hours (6.5 = 06:30), one per day
// phase; an entry may be unset (a hole). autowarmth_warmth: 11 values 0–100,
// +1000 = night mode on too; the menu keeps item i equal to item 12-i.

/** Index (0-based) of each day phase in both lists. */
export const PHASE = {
  midnightBefore: 0, astroDawn: 1, nauticalDawn: 2, civilDawn: 3, sunrise: 4, noon: 5,
  sunset: 6, civilDusk: 7, nauticalDusk: 8, astroDusk: 9, midnight: 10,
} as const

/** Simple mode uses only these times (main.lua:375-383, menu 1003-1013). */
export const SIMPLE_TIMES: number[] = [PHASE.civilDawn, PHASE.sunrise, PHASE.sunset, PHASE.civilDusk]
/** Every time, in the order of the day. */
export const ALL_TIMES: number[] = Array.from({ length: 11 }, (_, i) => i)

/** The warmth rows the menu shows, midday first (main.lua:1187-1192); `expert` rows only outside Simple mode. */
export const WARMTH_ROWS: { index: number; label: string; expert: boolean }[] = [
  { index: PHASE.noon, label: 'Midday', expert: false },
  { index: PHASE.sunrise, label: 'Sunrise and sunset', expert: false },
  { index: PHASE.civilDawn, label: 'Darkest civil twilight', expert: false },
  { index: PHASE.nauticalDawn, label: 'Darkest nautical twilight', expert: true },
  { index: PHASE.astroDawn, label: 'Darkest astronomical twilight', expert: true },
  { index: PHASE.midnightBefore, label: 'Midnight', expert: true },
]

export const NIGHT = 1000

/** 6.5 → { h: 6, m: 30 } — KOReader's own rounding (main.lua:935-936). -0.5 → { h: -1, m: 30 }. */
export function hoursToClock(x: number): { h: number; m: number } {
  let h = Math.floor(x)
  let m = Math.floor((x - h) * 60 + 0.5)
  if (m === 60) { h += 1; m = 0 }
  return { h, m }
}

/** { h: 6, m: 30 } → 6.5 (as the menu stores it: hour + min/60). */
export function clockToHours(h: number, m: number): number {
  return Math.round((h + m / 60) * 1e6) / 1e6
}

/** 6.5 → "06:30"; 24 → "24:00"; -0.5 → "23:30 (day before)"; null → "Not used". */
export function formatHours(x: number | null): string {
  if (x === null) return 'Not used'
  const { h, m } = hoursToClock(x)
  const two = (n: number) => String(n).padStart(2, '0')
  if (h < 0) return `${two(24 + h)}:${two(m)} (day before)`
  return `${two(h)}:${two(m)}`
}

/** The time rows to show: four in Simple mode, all eleven in expert mode. */
export function visibleTimes(simple: boolean): number[] {
  return simple ? SIMPLE_TIMES : ALL_TIMES
}

/** Copy with one time changed (null = not used). */
export function withTime(times: (number | null)[], index: number, value: number | null): (number | null)[] {
  const out = [...times]
  out[index] = value
  return out
}

/**
 * Copy with one time set, keeping the day in order the way KOReader's menu
 * offers to (main.lua:955-985): set times before it that are later move back
 * to it, set times after it that are earlier move forward to it. `moved` lists
 * the other entries that changed.
 */
export function withTimeOrdered(times: (number | null)[], index: number, value: number | null): { times: (number | null)[]; moved: number[] } {
  const out = withTime(times, index, value)
  const moved: number[] = []
  if (value === null) return { times: out, moved }
  for (let i = index - 1; i >= 0; i--) {
    const x = out[i]
    if (x === null || x === undefined) continue
    if (x <= value) break
    out[i] = value
    moved.push(i)
  }
  for (let i = index + 1; i < out.length; i++) {
    const x = out[i]
    if (x === null || x === undefined) continue
    if (x >= value) break
    out[i] = value
    moved.push(i)
  }
  return { times: out, moved }
}

/** Index of the first set time that is earlier than a set time before it, or -1. */
export function firstOutOfOrder(times: (number | null)[]): number {
  let prev = -Infinity
  for (let i = 0; i < times.length; i++) {
    const x = times[i]
    if (x === null || x === undefined) continue
    if (x < prev) return i
    prev = x
  }
  return -1
}

/** A warmth entry split: the percentage and whether night mode is on. */
export function splitWarmth(v: number): { percent: number; night: boolean } {
  return v > 100 ? { percent: Math.max(v - NIGHT, 0), night: true } : { percent: v, night: false }
}

/** Copy with one phase set and its partner (item 12-i) set to the same, as the menu does (main.lua:1074). */
export function withWarmth(warmth: number[], index: number, percent: number, night: boolean): number[] {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  const v = night ? p + NIGHT : p
  const out = [...warmth]
  out[index] = v
  out[out.length - 1 - index] = v
  return out
}
