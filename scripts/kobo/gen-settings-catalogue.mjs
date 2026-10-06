#!/usr/bin/env node
// Builds src/features/books/koboSettingsCatalogue.ts from docs/kobo/koreader-settings.json
// (every KOReader setting, verified against v2026.07.1 with file:line citations).
//
// Left out on purpose:
//   - risky keys (could lock the owner out, turn the plugin or statistics off,
//     delete files, break the network or SSH);
//   - keys this Kobo has no hardware for (rotation sensor, page-turn buttons, colour);
//   - keys that hold Lua tables or arrays — except the few typed as "list" in the JSON
//     (a fixed-length array of numbers with ranges, e.g. AutoWarmth's schedule and
//     warmth, the L/R margins); the plugin checks those against the same spec;
//   - keys that would end refused, lock the owner out of typing or page turns, or turn Wi-Fi on by itself;
//   - secrets (passwords, tokens) — they would be read back into the app;
//   - frontlight/warmth levels: KOReader overwrites them with the live values on
//     every suspend, so writing them does nothing.
// Dotted keys (footer.x, statistics.x …) are one field inside one setting; the
// plugin merges them. Project: Title keeps its own settings (pt:<key>).
//
//   node scripts/kobo/gen-settings-catalogue.mjs           # rewrite
//   node scripts/kobo/gen-settings-catalogue.mjs --check   # exit 1 if stale

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = JSON.parse(readFileSync(join(root, 'docs/kobo/koreader-settings.json'), 'utf8'))
const TARGET = join(root, 'src/features/books/koboSettingsCatalogue.ts')
// Plain-language help for every setting and section (docs/kobo/settings-help/*.json),
// written from the KOReader source for a reader, not a developer.
const HELP_DIR = join(root, 'docs/kobo/settings-help')
const HELP = { groups: {}, settings: {} }
for (const f of readdirSync(HELP_DIR).filter(f => f.endsWith('.json')).sort()) {
  const h = JSON.parse(readFileSync(join(HELP_DIR, f), 'utf8'))
  Object.assign(HELP.groups, h.groups)
  Object.assign(HELP.settings, h.settings)
}

const SKIP_KEYS = new Set([
  'frontlight_intensity', 'frontlight_warmth', 'is_frontlight_on',
  // the plugin never writes these (lbcore deny list) — offering them would only end in "refused"
  'home_dir', 'start_with',
  // could leave the owner unable to type or turn pages, or make KOReader switch Wi-Fi on by itself
  'virtual_keyboard_enabled', 'page_turns_disable_tap', 'page_turns_disable_swipe', 'wifi_enable_action',
  // stored but read by nothing, or a sum of flags no one can type: offering them only confuses
  'custom_screen_dpi', 'kopt_detect_indent', 'notification_sources_to_show_mask',
  'pt:show_progress_in_mosaic', 'pt:opened_at_top_of_library',
])
/** Secrets never leave the device, not even as a read-back value. */
const SECRET = /password|token|secret|api_?key/i
const MANAGED = new Set(['screensaver_dir', 'screensaver_document_cover'])
const GROUP_ID = { bookshelf_patch: 'bookshelf' }
const GROUP_LABEL = {
  bookshelf: 'Bookshelf sleep screen',
  defaults_reflowable: 'Defaults for new EPUB books',
  defaults_fixed: 'Defaults for new PDFs and comics',
  fonts_typography: 'Fonts and typography (new EPUB books)',
  plugin_tables: 'Plugins: statistics, read timer, vocabulary',
  hidden_tunables: 'Advanced',
  alt_status_bar: 'Top status bar (EPUB)',
  status_bar: 'Bottom status bar',
}
const SKIP_GROUPS = new Set(['developer'])

// Friendlier words where the device's own menu text needs context on the web.
const OVERRIDES = {
  screensaver_type: {
    label: 'What the sleep screen shows',
    options: [
      { value: 'cover', label: 'Cover of the book you are reading' },
      { value: 'bookshelf', label: 'Bookshelf (recent books as spines)' },
      { value: 'random_image', label: 'My images (from the app)' },
      { value: 'document_cover', label: 'One image I pick' },
      { value: 'readingprogress', label: 'Reading progress' },
      { value: 'bookstatus', label: 'Book status' },
      { value: 'disable', label: 'Leave the screen as it is' },
    ],
    help: 'The book cover needs a book opened in KOReader at least once; until then KOReader falls back to an image.',
  },
  auto_restore_wifi: { help: 'Turns Wi-Fi back on after sleep only if it was on before. The plugin syncs whenever Wi-Fi comes on.' },
}

/** A "list" setting's shape: length, which numbers each item may hold, and its editor. */
function listSpec(s) {
  const l = s.list
  if (!l || !Number.isInteger(l.length) || !['schedule', 'warmth', 'pair'].includes(l.editor)) throw new Error(`bad list spec for ${s.key}`)
  if (!Array.isArray(s.absent_means) || s.absent_means.length !== l.length) throw new Error(`list default for ${s.key} must have ${l.length} items`)
  const out = { length: l.length, nullable: !!l.nullable, integer: !!l.integer, editor: l.editor, labels: l.labels ?? [] }
  if (l.ranges) out.ranges = l.ranges
  if (l.positions) out.positions = l.positions
  if (!out.ranges && !out.positions) throw new Error(`list ${s.key} needs ranges or positions`)
  if (l.ascending) out.ascending = true
  if (l.mirrored) out.mirrored = true
  return out
}

const scalar = v => v === null || ['boolean', 'number', 'string'].includes(typeof v)
const isTableValue = s => (s.default !== null && typeof s.default === 'object') ||
  (s.type === 'string' && /lua (table|array)|\btable\b|\barray\b/i.test(`${s.notes ?? ''}`))

function clean(s, group) {
  const o = OVERRIDES[s.key] ?? {}
  const def = {
    key: s.key,
    label: o.label ?? s.label,
    path: (s.path ?? '').replace(/\s*\((?:⚙|🔧|☰|.) ?tab\)/gu, '').trim() || group.label,
    type: s.type,
    // A string setting's "absent" is often a description ("book language, else English"),
    // not a value: keep it as help, never as something the app could send back.
    // A font setting's "absent" is a real font (KOReader's own default), so it is kept.
    absent: s.type === 'list' ? (Array.isArray(s.absent_means) ? s.absent_means : null)
      : s.type === 'string' && !s.font ? null : scalar(s.absent_means) ? s.absent_means : null,
    effect: ['immediate', 'next_sleep', 'next_book', 'restart'].includes(s.effect) ? s.effect : 'restart',
    source: s.source,
  }
  if (o.options ?? s.options) def.options = (o.options ?? s.options).filter(x => x.value !== null && scalar(x.value)).map(x => ({ value: x.value, label: x.label }))
  for (const k of ['min', 'max', 'step', 'unit']) if (s[k] !== undefined && s[k] !== null) def[k] = s[k]
  if (def.type === 'string') def.maxLength = 500
  // -1 (or another sentinel) that turns the feature off, outside min…max.
  if (typeof s.off === 'number') def.off = s.off
  if (s.font === 'face' || s.font === 'file') def.font = s.font
  if (s.type === 'list') def.list = listSpec(s)
  if (MANAGED.has(s.key)) def.managed = true
  return withHelp(def, o)
}

/** The plain-language label, help, example, level and option names; every setting must have help. */
function withHelp(def, o = {}) {
  const h = HELP.settings[def.key]
  if (!h || !h.help) throw new Error(`no help for ${def.key} — add it to docs/kobo/settings-help/`)
  if (h.label && !o.label) def.label = h.label
  def.help = h.help
  if (h.example) def.example = h.example
  def.level = h.level === 'basic' ? 'basic' : 'advanced'
  if (h.options && def.options && !o.options) {
    def.options = def.options.map(x => ({ ...x, label: h.options[String(x.value)] ?? x.label }))
  }
  return def
}

const groups = []
for (const g of src.groups) {
  if (SKIP_GROUPS.has(g.id)) continue
  const settings = g.settings
    .filter(s => !s.risky && s.kobo_clara_bw !== false && !SKIP_KEYS.has(s.key) && !SECRET.test(s.key) && (s.type === 'list' || !isTableValue(s)))
    .filter(s => s.type !== 'enum' || (s.options ?? []).length > 0)
    .map(s => clean(s, g))
  const id = GROUP_ID[g.id] ?? g.id
  if (settings.length) groups.push(withGroupHelp({ id, label: GROUP_LABEL[id] ?? g.label.replace(/\s*\(.*\)\s*$/, '').replace(/ — .*$/, ''), settings }))
}

function withGroupHelp(g) {
  const h = HELP.groups[g.id]
  if (!h) throw new Error(`no help for group ${g.id}`)
  return { ...g, label: h.title ?? g.label, summary: h.summary, affects: h.affects }
}

// Project: Title (its own SQLite config; takes effect after a restart).
const PT_MODES = [
  { value: 'list_image_meta', label: 'Cover list' }, { value: 'mosaic_image', label: 'Cover grid' },
  { value: 'list_only_meta', label: 'Details list' }, { value: 'list_no_meta', label: 'File names' },
]
const pt = src.project_title.settings
  .filter(s => s.key !== 'config_version' && s.key !== 'series_mode' && ['bool', 'int', 'enum'].includes(s.type) && !SKIP_KEYS.has(`pt:${s.key}`))
  .map(s => {
    const def = {
      key: `pt:${s.key}`, label: s.label, path: 'Project: Title → Settings', type: s.type,
      absent: s.type === 'bool' ? (s.default ?? false) : (s.default ?? null), effect: 'restart',
      source: `projecttitle.koplugin/${s.source}`,
    }
    if (s.type === 'enum') def.options = PT_MODES
    if (s.min !== undefined) def.min = s.min
    if (s.max !== undefined) def.max = s.max
    return withHelp(def)
  })
groups.splice(2, 0, withGroupHelp({ id: 'project_title', label: 'Library (Project: Title)', settings: pt }))
const unused = Object.keys(HELP.settings).filter(k => !groups.some(g => g.settings.some(d => d.key === k)) && !SKIP_KEYS.has(k))
if (unused.length) console.warn(`help for settings not in the catalogue: ${unused.join(', ')}`)

const total = groups.reduce((t, g) => t + g.settings.length, 0)
const body = `// GENERATED by scripts/kobo/gen-settings-catalogue.mjs from docs/kobo/koreader-settings.json —
// do not edit by hand. ${total} settings in ${groups.length} groups, each read from KOReader
// v2026.07.1's source (\`source\` = file:line). Also GENERATED into supabase/functions/kobo-sync
// with koboSettings.ts. \`absent\` is what KOReader does when the key is not set at all.

export interface SettingOption { value: string | number | boolean; label: string }

/** A fixed-length array of numbers (a Lua table on the Kobo). */
export interface ListSpec {
  length: number
  /** An item may be missing (null here, a hole in the Lua table). */
  nullable: boolean
  integer: boolean
  /** Which editor the app shows. */
  editor: 'schedule' | 'warmth' | 'pair'
  /** One name per item. */
  labels: string[]
  /** Every item must lie in one of these [min, max] ranges… */
  ranges?: [number, number][]
  /** …or item i in positions[i]. */
  positions?: [number, number][]
  /** The items that are set never go down. */
  ascending?: boolean
  /** Item i equals item length-1-i (AutoWarmth's warmth: dawn and dusk share a value). */
  mirrored?: boolean
}

export interface SettingDef {
  key: string
  label: string
  /** Where KOReader shows it, for "find it on the Kobo". */
  path: string
  type: 'bool' | 'enum' | 'int' | 'number' | 'string' | 'list'
  absent: boolean | number | string | (number | null)[] | null
  options?: SettingOption[]
  min?: number
  max?: number
  step?: number
  unit?: string
  maxLength?: number
  /** The value that turns the feature off (e.g. -1), allowed outside min…max. */
  off?: number
  /** A font: a face name (crengine's font menu) or a font file path (the status bar). */
  font?: 'face' | 'file'
  /** type 'list' only. */
  list?: ListSpec
  /** When the Kobo starts using a new value. */
  effect: 'immediate' | 'next_sleep' | 'next_book' | 'restart'
  /** What it does, in everyday words (docs/kobo/settings-help). */
  help: string
  /** A concrete everyday example, when one helps. */
  example?: string
  /** basic = an ordinary reader may want it; advanced = niche or technical. */
  level: 'basic' | 'advanced'
  /** Set by the plugin itself (e.g. the sleep image folder), never from the app directly. */
  managed?: boolean
  source: string
}

export interface SettingGroup {
  id: string
  label: string
  /** What the section is about. */
  summary: string
  /** What you notice on the Kobo when you change something here. */
  affects: string
  settings: SettingDef[]
}

export const SETTING_GROUPS: SettingGroup[] = [
${groups.map(g => `  {
    id: ${JSON.stringify(g.id)}, label: ${JSON.stringify(g.label)},
    summary: ${JSON.stringify(g.summary)},
    affects: ${JSON.stringify(g.affects)},
    settings: [
${g.settings.map(d => `      ${JSON.stringify(d)},`).join('\n')}
    ],
  },`).join('\n')}
]
`
// The plugin's own allow-list: the same keys with their Lua type, so the Kobo
// refuses anything the catalogue does not list, whatever the server sends.
const LUA_TYPE = { bool: 'boolean', int: 'number', number: 'number', enum: null, string: 'string' }
const luaPairs = ps => `{ ${ps.map(([a, b]) => `{ ${a}, ${b} }`).join(', ')} }`
/** A list's spec as a Lua table: { list = n, holes = bool, int = bool, ranges | pos = {{min, max}, …}, ascending, mirrored }. */
function luaList(l) {
  const parts = [`list = ${l.length}`, `holes = ${l.nullable}`, `int = ${l.integer}`]
  if (l.ranges) parts.push(`ranges = ${luaPairs(l.ranges)}`)
  if (l.positions) parts.push(`pos = ${luaPairs(l.positions)}`)
  if (l.ascending) parts.push('ascending = true')
  if (l.mirrored) parts.push('mirrored = true')
  return `{ ${parts.join(', ')} }`
}
const luaLines = groups.flatMap(g => g.settings.filter(d => !d.managed).map(d => {
  if (d.type === 'list') return `    [${JSON.stringify(d.key)}] = ${luaList(d.list)},`
  const t = LUA_TYPE[d.type] ?? (typeof d.options?.[0]?.value === 'number' ? 'number' : typeof d.options?.[0]?.value === 'boolean' ? 'boolean' : 'string')
  return `    [${JSON.stringify(d.key)}] = "${t}",`
}))
const lua = `-- GENERATED by scripts/kobo/gen-settings-catalogue.mjs — do not edit by hand.
-- Every setting the app may change on this Kobo, with the Lua type it must have
-- (a table = a fixed-length list of numbers, checked by lbcore.listAllowed).
-- SPDX-License-Identifier: AGPL-3.0-or-later
return {
${luaLines.join('\n')}
}
`
const LUA_TARGET = join(root, 'scripts/kobo/lascisboard.koplugin/lbsettings.lua')
const read = p => { try { return readFileSync(p, 'utf8') } catch { return '' } }
if (read(TARGET) === body && read(LUA_TARGET) === lua) { console.log('already up to date'); process.exit(0) }
if (process.argv.includes('--check')) { console.error('settings catalogue is stale — run node scripts/kobo/gen-settings-catalogue.mjs'); process.exit(1) }
writeFileSync(TARGET, body)
writeFileSync(LUA_TARGET, lua)
console.log(`koboSettingsCatalogue.ts + lbsettings.lua: ${total} settings in ${groups.length} groups`)
