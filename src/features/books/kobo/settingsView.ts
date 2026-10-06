// How a KOReader setting reads on the Kobo tab — pure, verified by
// scripts/verify-kobo-settings.cjs. Three values meet here: what the app asked
// for (kobo_device_config.settings), what the Kobo last reported, and what
// KOReader does when the key is not set at all (`absent`).

import type { SettingDef } from '../koboSettingsCatalogue'
import { baseUnit, formatDuration } from './durations'
import { formatHours } from './autowarmth'

export type Value = boolean | number | string | (number | null)[] | null

export interface SettingView {
  /** The value the control shows. */
  value: Value
  /** The owner set a value in the app (a Reset button makes sense; a reset is stored as null). */
  changed: boolean
  /** The app asked for something the Kobo has not reported yet. */
  pending: boolean
  /** What the Kobo reported, in words — "(default)" when the key is not set there; null when it never reported. */
  onKobo: string | null
}

const same = (a: unknown, b: unknown) => a === b || (a == null && b == null)
  || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b))

export function settingView(def: SettingDef, wanted: Record<string, Value> | undefined, reported: Record<string, unknown> | undefined): SettingView {
  const hasWanted = !!wanted && Object.prototype.hasOwnProperty.call(wanted, def.key)
  const want = hasWanted ? wanted![def.key] : undefined
  const hasReport = !!reported
  const rep = hasReport && Object.prototype.hasOwnProperty.call(reported, def.key) ? reported![def.key] as Value : undefined
  const deviceValue = rep === undefined ? def.absent : rep
  const value = hasWanted ? (want === null ? def.absent : want!) : deviceValue
  const pending = hasWanted && hasReport && !same(want === null ? def.absent : want, deviceValue)
  const onKobo = !hasReport ? null : rep === undefined ? `${formatValue(def, deviceValue)} (default)` : formatValue(def, deviceValue)
  return { value, changed: hasWanted && want !== null, pending, onKobo }
}

/** A value in words: the option's label, "On"/"Off", a duration, a list, or the text. */
export function formatValue(def: SettingDef, v: Value): string {
  if (v === null || v === undefined) return 'Not set'
  if (def.type === 'bool') return v ? 'On' : 'Off'
  if (def.type === 'enum') return def.options?.find(o => o.value === v)?.label ?? String(v)
  if (Array.isArray(v)) return formatList(def, v)
  if (typeof v === 'number' && baseUnit(def)) return formatDuration(v, def)
  if (typeof v === 'number') return `${v}${def.unit ? ` ${def.unit}` : ''}`
  if (def.font === 'file' && typeof v === 'string') return fontFileName(v)
  return v === '' ? 'Empty' : String(v)
}

/** A list in one short line: "Sunrise 07:00 · Sunset 21:30 …", "60 % · night", "15 / 15". */
function formatList(def: SettingDef, v: (number | null)[]): string {
  const spec = def.list
  if (!spec) return v.join(', ')
  if (spec.editor === 'pair') return v.map(x => x ?? '–').join(' / ') + (def.unit === '%' ? ' %' : '')
  const labels = spec.labels
  if (spec.editor === 'schedule') {
    return v.map((x, i) => x === null ? null : `${labels[i] ?? i + 1} ${formatHours(x)}`).filter(Boolean).join(' · ')
  }
  // warmth: midday, sunrise/sunset, twilight… (the first half mirrors the second)
  const parts: string[] = []
  for (let i = Math.floor((v.length - 1) / 2); i >= 0; i--) {
    const x = v[i]
    parts.push(`${labels[i] ?? i + 1} ${x === null ? '–' : x > 100 ? `${x - 1000} % + night` : `${x} %`}`)
  }
  return parts.join(' · ')
}

/** "./fonts/noto/NotoSans-Regular.ttf" → "NotoSans-Regular". */
export function fontFileName(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.[^.]+$/, '') || path
}

/** 900 → "15 min", 259200 → "3 days", 5400 → "1 h 30 min". */
export function formatSeconds(s: number): string {
  return formatDuration(s, { unit: 'seconds', type: 'int' })
}

export const EFFECT_LABEL: Record<SettingDef['effect'], string> = {
  immediate: 'Right after the Kobo syncs',
  next_sleep: 'The next time the Kobo goes to sleep',
  next_book: 'The next time you open a book',
  restart: 'After KOReader restarts',
}

/** Case- and accent-insensitive search over the label, the plain help, the example, the path and the key. */
export function matchesSetting(def: SettingDef, query: string): boolean {
  const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = fold(query.trim())
  if (!q) return true
  return fold(`${def.label} ${def.help} ${def.example ?? ''} ${def.path} ${def.key}`).includes(q)
}
