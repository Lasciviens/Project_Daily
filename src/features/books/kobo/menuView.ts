// The KOReader menu as the Kobo tab edits it — pure, verified by
// scripts/verify-kobo-settings.cjs. The Kobo reports its menus (every list and
// every item's label); the app keeps only the lists the owner changed.

import { MENU_SEPARATOR, type MenuReport } from '../koboSettings'

/** The tab bar's lists by their KOReader ids (the tabs are icons on the device). */
export const TAB_NAMES: Record<string, string> = {
  filemanager_settings: 'File browser (folder icon)',
  setting: 'Settings (gear)',
  tools: 'Tools (wrench)',
  search: 'Search (magnifier)',
  plus_menu: 'Plus (+)',
  main: 'Main (menu icon)',
  navi: 'Navigation (bookmark)',
  typeset: 'Typeset (document)',
  filemanager: 'File browser (folder icon)',
}

/** The order the Kobo will use: its own lists with the owner's lists over them. */
export function effectiveOrder(report: MenuReport | undefined, overrides: Record<string, string[]> | undefined): Record<string, string[]> {
  return { ...(report?.order ?? {}), ...(overrides ?? {}) }
}

/** A list's name: a tab's name, an item's label, or the id made readable. */
export function listName(id: string, labels: Record<string, string>): string {
  return TAB_NAMES[id] ?? labels[id] ?? id.replace(/_/g, ' ')
}

/** Items the Kobo actually shows in a list (an order file names items a device may not have). */
export function visibleItems(list: string[], labels: Record<string, string>, order: Record<string, string[]>): string[] {
  return list.filter(id => id === MENU_SEPARATOR || labels[id] !== undefined || (Array.isArray(order[id]) && order[id].length > 0))
}

/**
 * One step up or down past the neighbouring VISIBLE item; hidden ids keep
 * their places. Returns the new list, or null at the edge.
 */
export function stepItem(list: string[], index: number, dir: -1 | 1, visible: Set<string>, item: string): string[] | null {
  let j = index + dir
  while (j >= 0 && j < list.length && !visible.has(list[j])) j += dir
  if (j < 0 || j >= list.length) return null
  const next = list.slice()
  next.splice(index, 1)
  next.splice(j, 0, item)
  return next
}

/** Every list an item can move to: the tabs first, then the submenus, by name. */
export function moveTargets(order: Record<string, string[]>, labels: Record<string, string>, tabs: string[]): { id: string; name: string }[] {
  const subs = Object.keys(order).filter(id => id !== 'KOMenu:menu_buttons' && !tabs.includes(id) && labels[id] !== undefined)
    .map(id => ({ id, name: listName(id, labels) })).sort((a, b) => a.name.localeCompare(b.name))
  return [...tabs.map(id => ({ id, name: listName(id, labels) })), ...subs]
}

/** True when `target` is `item` itself or a submenu somewhere inside it (moving there would make a loop). */
export function inside(order: Record<string, string[]>, item: string, target: string): boolean {
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === target) return true
    if (seen.has(id)) return false
    seen.add(id)
    return (order[id] ?? []).some(walk)
  }
  return walk(item)
}

/**
 * The rows to draw: visible items, with separators only BETWEEN visible
 * items (a separator next to a hidden item, at an edge or doubled is left
 * out). Keeps each row's index in the full list for moves.
 */
export function rowsToShow(list: string[], labels: Record<string, string>, order: Record<string, string[]>): { id: string; index: number }[] {
  const visible = new Set(visibleItems(list, labels, order))
  const rows: { id: string; index: number }[] = []
  list.forEach((id, index) => {
    if (!visible.has(id)) return
    if (id === MENU_SEPARATOR) {
      const last = rows[rows.length - 1]
      if (!last || last.id === MENU_SEPARATOR) return
    }
    rows.push({ id, index })
  })
  while (rows.length && rows[rows.length - 1].id === MENU_SEPARATOR) rows.pop()
  return rows
}

/**
 * Share of a side's menu items (in its tabs, separators left out) the Kobo
 * sent a name for. A low share means the report was taken before KOReader
 * had built the menu (plugin 1.1 inside a book) — editing it would be
 * guesswork, so the app waits for a full report.
 */
export function labelCoverage(tabs: string[], labels: Record<string, string>, order: Record<string, string[]>): number {
  const ids = tabs.flatMap(t => order[t] ?? []).filter(id => id !== MENU_SEPARATOR)
  if (ids.length === 0) return 0
  return ids.filter(id => labels[id] !== undefined || (order[id]?.length ?? 0) > 0).length / ids.length
}

export const MIN_LABEL_COVERAGE = 0.6
