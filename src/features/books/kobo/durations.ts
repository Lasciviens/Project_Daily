// Time-valued KOReader settings (stored in ms, seconds or minutes) shown and
// typed in a unit a person thinks in — pure, verified by
// scripts/verify-kobo-settings.cjs. The stored value always stays in
// KOReader's own unit (the catalogue's `unit`, read from its source).

import type { SettingDef } from '../koboSettingsCatalogue'

export type TimeUnit = 'ms' | 's' | 'min' | 'h' | 'd'

const MS: Record<TimeUnit, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 }
const ORDER: TimeUnit[] = ['ms', 's', 'min', 'h', 'd']

export const UNIT_LABEL: Record<TimeUnit, string> = { ms: 'ms', s: 'seconds', min: 'minutes', h: 'hours', d: 'days' }

/** The unit KOReader stores the setting in, or null when it is not a duration. */
export function baseUnit(def: Pick<SettingDef, 'unit' | 'type'>): TimeUnit | null {
  if (def.type !== 'int' && def.type !== 'number') return null
  const u = (def.unit ?? '').trim().toLowerCase()
  if (/^ms\b/.test(u)) return 'ms'
  if (/^seconds?\b/.test(u)) return 's'
  if (/^minutes?\b/.test(u)) return 'min'
  return null
}

/**
 * The units offered for typing: the stored unit and the bigger ones that fit
 * (at least two of them inside the maximum), never a unit smaller than the
 * setting's step. Milliseconds go up to seconds only.
 */
export function unitChoices(def: Pick<SettingDef, 'unit' | 'type' | 'max' | 'step'>): TimeUnit[] {
  const base = baseUnit(def)
  if (!base) return []
  const maxMs = (def.max ?? Infinity) * MS[base]
  const stepMs = (def.step ?? 0) * MS[base]
  const top: TimeUnit = base === 'ms' ? 's' : 'd'
  const out = ORDER.slice(ORDER.indexOf(base), ORDER.indexOf(top) + 1)
    .filter(u => u === base || maxMs >= 2 * MS[u])
    .filter(u => !stepMs || MS[u] >= stepMs || u === base)
  // A step of whole minutes (e.g. 60 s) leaves seconds out: they could only hold multiples of 60.
  return stepMs && stepMs % MS.min === 0 && out.length > 1 ? out.filter(u => MS[u] >= stepMs) : out
}

/** A stored value split for the input: the biggest offered unit it divides into exactly. */
export function splitDuration(value: number, def: Pick<SettingDef, 'unit' | 'type' | 'max' | 'step'>): { amount: number; unit: TimeUnit } {
  const base = baseUnit(def) ?? 's'
  const choices = unitChoices(def)
  const ms = Math.round(value * MS[base] * 1000) / 1000
  for (const u of [...choices].reverse()) {
    if (ms !== 0 && Number.isInteger(ms / MS[u])) return { amount: ms / MS[u], unit: u }
  }
  const unit = choices[0] ?? base
  return { amount: round(ms / MS[unit]), unit }
}

/** An amount in a unit → the stored value: rounded for whole-number settings, kept inside min…max. */
export function toStored(amount: number, unit: TimeUnit, def: Pick<SettingDef, 'unit' | 'type' | 'min' | 'max'>): number {
  const base = baseUnit(def) ?? unit
  let v = (amount * MS[unit]) / MS[base]
  v = def.type === 'int' ? Math.round(v) : round(v)
  if (def.min !== undefined) v = Math.max(def.min, v)
  if (def.max !== undefined) v = Math.min(def.max, v)
  return v
}

/** 900 s → "15 min", 5400 s → "1 h 30 min", 259200 s → "3 days", 300 ms → "300 ms", 1500 ms → "1.5 s", the off value → "Off". */
export function formatDuration(value: number, def: Pick<SettingDef, 'unit' | 'type' | 'off'>): string {
  if (def.off !== undefined && value === def.off) return 'Off'
  const base = baseUnit(def) ?? 's'
  const sign = value < 0 ? '−' : ''
  const ms = Math.round(Math.abs(value) * MS[base])
  if (ms === 0) return `0 ${base === 'ms' ? 'ms' : base === 'min' ? 'min' : 's'}`
  if (ms < 1000) return `${sign}${ms} ms`
  if (ms < 60_000) return `${sign}${round(ms / 1000)} s`
  const parts: string[] = []
  let rest = ms
  for (const u of ['d', 'h', 'min', 's'] as const) {
    const n = Math.floor(rest / MS[u])
    if (n > 0) {
      parts.push(u === 'd' ? `${n} ${n === 1 ? 'day' : 'days'}` : `${n} ${u}`)
      rest -= n * MS[u]
    }
  }
  return sign + parts.slice(0, 2).join(' ')
}

/** An amount in one unit expressed in another (90 min → 1.5 h), two decimals at most. */
export function convertAmount(amount: number, from: TimeUnit, to: TimeUnit): number {
  return round((amount * MS[from]) / MS[to])
}

const round = (n: number) => Math.round(n * 100) / 100
