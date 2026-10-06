// KOReader settings and menu order chosen in the app — pure and import-free
// apart from the catalogue, GENERATED into supabase/functions/kobo-sync by
// scripts/sync-kobo-shared.mjs and verified by scripts/verify-kobo-settings.cjs.
//
// The app stores only what the owner changed (kobo_device_config.settings:
// { key: value }, or { key: null } for "back to KOReader's default"). The
// server sends a key only when the catalogue lists it and the value has the
// catalogue's type; the plugin checks the same again before it writes
// G_reader_settings. So a typo or an old key can never reach the device.

import { SETTING_GROUPS, type ListSpec, type SettingDef } from './koboSettingsCatalogue'


export type SettingValue = boolean | number | string | (number | null)[] | null

/** Every catalogue entry by key. */
export function settingIndex(): Map<string, SettingDef> {
  const m = new Map<string, SettingDef>()
  for (const g of SETTING_GROUPS) for (const s of g.settings) m.set(s.key, s)
  return m
}

/** The value if the definition accepts it (null = reset to default), else undefined. */
export function cleanValue(def: SettingDef, v: unknown): SettingValue | undefined {
  if (v === null) return null
  if (def.type === 'bool') return typeof v === 'boolean' ? v : undefined
  if (def.type === 'enum') return (def.options ?? []).some(o => o.value === v) ? v as string | number : undefined
  if (def.type === 'list') return def.list ? cleanList(def.list, v) : undefined
  if (def.type === 'int' || def.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
    if (def.off !== undefined && v === def.off) return v
    if (def.type === 'int' && !Number.isInteger(v)) return undefined
    if (def.min !== undefined && v < def.min) return undefined
    if (def.max !== undefined && v > def.max) return undefined
    return v
  }
  if (def.type === 'string') {
    if (typeof v !== 'string') return undefined
    return v.length <= (def.maxLength ?? 500) ? v : undefined
  }
  return undefined
}

/**
 * A fixed-length list (a Lua table on the Kobo): every item a number in its
 * range (or null where holes are allowed), set items never going down when
 * `ascending`, item i equal to item n-1-i when `mirrored`. The plugin checks
 * the same (lbcore.listAllowed).
 */
export function cleanList(spec: ListSpec, v: unknown): (number | null)[] | undefined {
  if (!Array.isArray(v) || v.length !== spec.length) return undefined
  const out: (number | null)[] = []
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (x === null) { if (!spec.nullable) return undefined; out.push(null); continue }
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined
    if (spec.integer && !Number.isInteger(x)) return undefined
    const ranges = spec.positions ? [spec.positions[i]] : spec.ranges ?? []
    if (!ranges.some(r => r && x >= r[0] && x <= r[1])) return undefined
    out.push(x)
  }
  if (spec.ascending) {
    let prev = -Infinity
    for (const x of out) { if (x === null) continue; if (x < prev) return undefined; prev = x }
  }
  if (spec.mirrored && out.some((x, i) => x !== out[out.length - 1 - i])) return undefined
  if (spec.nullable && out.every(x => x === null)) return undefined
  return out
}

/** Keeps only catalogue keys with valid values; reports the rest. */
export function cleanSettings(raw: unknown): { settings: Record<string, SettingValue>; refused: string[] } {
  const settings: Record<string, SettingValue> = {}
  const refused: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings, refused }
  const index = settingIndex()
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = index.get(k)
    const clean = def && !def.managed ? cleanValue(def, v) : undefined
    if (clean === undefined) refused.push(k)
    else settings[k] = clean
  }
  return { settings, refused }
}

// ── Menu order ───────────────────────────────────────────────────────────────
// KOReader builds each menu from an order table: list id → item ids (a list
// id that is also an item is a submenu; "----------------------------" is a
// separator). A user file settings/<side>_menu_order.lua overrides whole lists.
// The app stores only the lists the owner changed, per side.

export const MENU_SIDES = ['filemanager', 'reader'] as const
export type MenuSide = typeof MENU_SIDES[number]
export const MENU_SEPARATOR = '----------------------------'
const MENU_ID = /^[A-Za-z0-9_:.-]{1,80}$/

export type MenuOrder = Partial<Record<MenuSide, Record<string, string[]>>>

/** Valid ids only, no duplicates within a list, at most 200 items a list and 80 lists a side. */
export function cleanMenuOrder(raw: unknown): MenuOrder {
  const out: MenuOrder = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const side of MENU_SIDES) {
    const lists = (raw as Record<string, unknown>)[side]
    if (!lists || typeof lists !== 'object' || Array.isArray(lists)) continue
    const clean: Record<string, string[]> = {}
    for (const [id, items] of Object.entries(lists as Record<string, unknown>).slice(0, 80)) {
      if (!MENU_ID.test(id) || !Array.isArray(items)) continue
      const seen = new Set<string>()
      const list: string[] = []
      for (const it of items.slice(0, 200)) {
        if (typeof it !== 'string') continue
        if (it === MENU_SEPARATOR) { if (list[list.length - 1] !== MENU_SEPARATOR) list.push(it); continue }
        if (!MENU_ID.test(it) || seen.has(it)) continue
        seen.add(it)
        list.push(it)
      }
      clean[id] = list
    }
    if (Object.keys(clean).length) out[side] = clean
  }
  return out
}

export interface MenuReport {
  /** The order KOReader uses now: list id → item ids (defaults merged with the user file). */
  order: Record<string, string[]>
  /** Item id → the text the menu shows. */
  labels: Record<string, string>
}

/** The ids of a side's tab bar, in order. */
export function menuTabs(report: MenuReport): string[] {
  return report.order['KOMenu:menu_buttons'] ?? []
}

/**
 * Moves an item to another list (or another place in the same list) and
 * returns the lists that changed, so the caller stores whole lists — KOReader
 * replaces a list wholesale when the user file names it.
 */
export function moveMenuItem(order: Record<string, string[]>, item: string, toList: string, toIndex: number): Record<string, string[]> {
  const changed: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(order)) {
    if (list.includes(item) && id !== toList) changed[id] = list.filter(x => x !== item)
  }
  const target = (order[toList] ?? []).filter(x => x !== item)
  const at = Math.max(0, Math.min(toIndex, target.length))
  target.splice(at, 0, item)
  changed[toList] = target
  return changed
}

/** True when an item id is a submenu (it has its own list). */
export function isSubmenu(order: Record<string, string[]>, id: string): boolean {
  return Array.isArray(order[id]) && id !== 'KOMenu:menu_buttons'
}
