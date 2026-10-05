// The KOReader settings grouped into a few areas a reader recognises — pure,
// verified by scripts/verify-kobo-settings.cjs. Each area holds whole catalogue
// groups (docs/kobo/settings-help writes the plain-language text for both).

import type { SettingDef, SettingGroup } from '../koboSettingsCatalogue'
import { matchesSetting } from './settingsView'

/** An area's colour (a chart token: identity, not status). */
export const tint = (n: number, alpha = 1) => `rgb(var(--chart-${n}) / ${alpha})`

export type AreaId = 'sleep' | 'screen' | 'look' | 'bars' | 'touch' | 'library' | 'notes' | 'system'

export interface Area {
  id: AreaId
  title: string
  /** One plain line under the title. */
  summary: string
  /** Catalogue group ids, in reading order. */
  groups: string[]
  /** A chart colour token (identity, not status): rgb(var(--chart-N)). */
  color: 1 | 2 | 3 | 4 | 5 | 6
}

export const AREAS: Area[] = [
  { id: 'sleep', title: 'Sleep and battery', color: 2, groups: ['power'],
    summary: 'When the Kobo goes to sleep or turns off, and how it saves battery.' },
  { id: 'screen', title: 'Screen and light', color: 6, groups: ['screen', 'frontlight', 'autowarmth', 'rotation'],
    summary: 'Screen refresh, night mode, the front light and its warmth.' },
  { id: 'look', title: 'How books look', color: 1, groups: ['fonts_typography', 'defaults_reflowable', 'defaults_fixed'],
    summary: 'Font, size, spacing and margins for books you open from now on.' },
  { id: 'bars', title: 'Status bars', color: 5, groups: ['status_bar', 'alt_status_bar'],
    summary: 'The small lines of information under and above the text: time, battery, pages left…' },
  { id: 'touch', title: 'Taps and page turns', color: 4, groups: ['taps_gestures', 'navigation'],
    summary: 'Where to tap to turn pages, swipes, and what happens at the end of a book.' },
  { id: 'library', title: 'Library and files', color: 3, groups: ['project_title', 'file_browser', 'document'],
    summary: 'How the book list looks, how files are shown and what KOReader remembers about a book.' },
  { id: 'notes', title: 'Highlights and dictionary', color: 2, groups: ['highlights_bookmarks', 'lookup'],
    summary: 'Highlighting, bookmarks, notes, the dictionary and translation.' },
  { id: 'system', title: 'Language and system', color: 6, groups: ['language_ui', 'network', 'plugin_tables', 'hidden_tunables'],
    summary: 'Language, keyboard, Wi-Fi, reading statistics and a few technical options.' },
]

/** Groups shown on the Sleep screen section instead (with your own images). */
export const SLEEP_GROUPS = ['sleep_screen', 'bookshelf']

export type LevelFilter = 'basic' | 'all'

export interface SettingsQuery {
  query: string
  level: LevelFilter
  /** Only settings you changed in the app. */
  changedOnly: boolean
}

/** Every catalogue group belongs to exactly one area or to the Sleep screen section. */
export function unplacedGroups(groups: readonly SettingGroup[]): string[] {
  const placed = new Set([...AREAS.flatMap(a => a.groups), ...SLEEP_GROUPS])
  return groups.map(g => g.id).filter(id => !placed.has(id))
}

/** The settings of one group that pass the filters (managed ones never show). */
export function visibleSettings(group: SettingGroup, q: SettingsQuery, isChanged: (key: string) => boolean): SettingDef[] {
  const searching = q.query.trim() !== ''
  return group.settings.filter(d => !d.managed
    && (searching || q.level === 'all' || d.level === 'basic' || isChanged(d.key))
    && (!q.changedOnly || isChanged(d.key))
    && matchesSetting(d, q.query))
}

export interface AreaSummary {
  area: Area
  groups: { group: SettingGroup; settings: SettingDef[] }[]
  /** Settings shown with the current filters. */
  shown: number
  /** Every setting in the area (managed left out). */
  total: number
  changed: number
}

/** Areas with their groups, filtered; an area or group with nothing to show is left out. */
export function summarizeAreas(groups: readonly SettingGroup[], q: SettingsQuery, isChanged: (key: string) => boolean): AreaSummary[] {
  const byId = new Map(groups.map(g => [g.id, g]))
  return AREAS.map(area => {
    const own = area.groups.map(id => byId.get(id)).filter((g): g is SettingGroup => !!g)
    const shown = own.map(group => ({ group, settings: visibleSettings(group, q, isChanged) })).filter(x => x.settings.length > 0)
    const all = own.flatMap(g => g.settings.filter(d => !d.managed))
    return {
      area, groups: shown,
      shown: shown.reduce((t, x) => t + x.settings.length, 0),
      total: all.length,
      changed: all.filter(d => isChanged(d.key)).length,
    }
  })
}
