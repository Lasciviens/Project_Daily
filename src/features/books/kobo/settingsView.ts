// How a KOReader setting reads on the Kobo tab — pure, verified by
// scripts/verify-kobo-settings.cjs. Three values meet here: what the app asked
// for (kobo_device_config.settings), what the Kobo last reported, and what
// KOReader does when the key is not set at all (`absent`).

import type { SettingDef } from '../koboSettingsCatalogue'

export type Value = boolean | number | string | null

export interface SettingView {
  /** The value the control shows. */
  value: Value
  /** The owner changed it in the app (a Reset button makes sense). */
  changed: boolean
  /** The app asked for something the Kobo has not reported yet. */
  pending: boolean
  /** What the Kobo reported, in words — "(default)" when the key is not set there; null when it never reported. */
  onKobo: string | null
}

const same = (a: unknown, b: unknown) => a === b || (a == null && b == null)

export function settingView(def: SettingDef, wanted: Record<string, Value> | undefined, reported: Record<string, unknown> | undefined): SettingView {
  const hasWanted = !!wanted && Object.prototype.hasOwnProperty.call(wanted, def.key)
  const want = hasWanted ? wanted![def.key] : undefined
  const hasReport = !!reported
  const rep = hasReport && Object.prototype.hasOwnProperty.call(reported, def.key) ? reported![def.key] as Value : undefined
  const deviceValue = rep === undefined ? def.absent : rep
  const value = hasWanted ? (want === null ? def.absent : want!) : deviceValue
  const pending = hasWanted && hasReport && !same(want === null ? def.absent : want, deviceValue)
  const onKobo = !hasReport ? null : rep === undefined ? `${formatValue(def, deviceValue)} (default)` : formatValue(def, deviceValue)
  return { value, changed: hasWanted, pending, onKobo }
}

/** A value in words: the option's label, "On"/"Off", a duration, or the text. */
export function formatValue(def: SettingDef, v: Value): string {
  if (v === null || v === undefined) return 'Not set'
  if (def.type === 'bool') return v ? 'On' : 'Off'
  if (def.type === 'enum') return def.options?.find(o => o.value === v)?.label ?? String(v)
  if (typeof v === 'number' && def.unit === 'seconds') return formatSeconds(v)
  if (typeof v === 'number') return `${v}${def.unit && def.unit !== 'seconds' ? ` ${def.unit}` : ''}`
  return v === '' ? 'Empty' : String(v)
}

/** 900 → "15 min", 259200 → "3 days", 5400 → "1 h 30 min". */
export function formatSeconds(s: number): string {
  if (s < 0) return 'Never'
  if (s % 86400 === 0 && s >= 86400) return `${s / 86400} ${s === 86400 ? 'day' : 'days'}`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h && m) return `${h} h ${m} min`
  if (h) return `${h} h`
  return `${m} min`
}

export const EFFECT_LABEL: Record<SettingDef['effect'], string> = {
  immediate: 'Right after the sync',
  next_sleep: 'From the next sleep',
  next_book: 'From the next book opened',
  restart: 'After KOReader restarts',
}

/** Case- and accent-insensitive search over label, path and key. */
export function matchesSetting(def: SettingDef, query: string): boolean {
  const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = fold(query.trim())
  if (!q) return true
  return fold(`${def.label} ${def.path} ${def.key} ${def.help ?? ''}`).includes(q)
}
