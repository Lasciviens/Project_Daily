#!/usr/bin/env node
// Builds src/features/books/koboSettingsCatalogue.ts from docs/kobo/koreader-settings.json
// (every KOReader setting, verified against v2026.07.1 with file:line citations).
//
// Left out on purpose:
//   - risky keys (could lock the owner out, turn the plugin or statistics off,
//     delete files, break the network or SSH);
//   - keys this Kobo has no hardware for (rotation sensor, page-turn buttons, colour);
//   - keys that hold Lua tables (lists/pairs) — no safe generic editor;
//   - frontlight/warmth levels: KOReader overwrites them with the live values on
//     every suspend, so writing them does nothing.
// Dotted keys (footer.x, statistics.x …) are one field inside one setting; the
// plugin merges them. Project: Title keeps its own settings (pt:<key>).
//
//   node scripts/kobo/gen-settings-catalogue.mjs           # rewrite
//   node scripts/kobo/gen-settings-catalogue.mjs --check   # exit 1 if stale

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = JSON.parse(readFileSync(join(root, 'docs/kobo/koreader-settings.json'), 'utf8'))
const TARGET = join(root, 'src/features/books/koboSettingsCatalogue.ts')

const SKIP_KEYS = new Set(['frontlight_intensity', 'frontlight_warmth', 'is_frontlight_on'])
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
  auto_restore_wifi: { help: 'Needed for automatic syncs: the plugin syncs whenever Wi-Fi comes on.' },
}

const scalar = v => v === null || ['boolean', 'number', 'string'].includes(typeof v)
const isTableValue = s => s.type === 'string' && /lua table|\btable\b/i.test(`${s.notes ?? ''}`) && !s.key.includes('.')

function clean(s, group) {
  const o = OVERRIDES[s.key] ?? {}
  const def = {
    key: s.key,
    label: o.label ?? s.label,
    path: (s.path ?? '').replace(/\s*\((?:⚙|🔧|☰|.) ?tab\)/gu, '').trim() || group.label,
    type: s.type,
    absent: scalar(s.absent_means) ? s.absent_means : null,
    effect: ['immediate', 'next_sleep', 'next_book', 'restart'].includes(s.effect) ? s.effect : 'restart',
    source: s.source,
  }
  if (o.options ?? s.options) def.options = (o.options ?? s.options).filter(x => x.value !== null && scalar(x.value)).map(x => ({ value: x.value, label: x.label }))
  for (const k of ['min', 'max', 'step', 'unit']) if (s[k] !== undefined && s[k] !== null) def[k] = s[k]
  if (def.type === 'string') def.maxLength = 500
  const help = o.help ?? s.notes
  if (help) def.help = help.length > 240 ? `${help.slice(0, 237).trimEnd()}…` : help
  if (MANAGED.has(s.key)) def.managed = true
  return def
}

const groups = []
for (const g of src.groups) {
  if (SKIP_GROUPS.has(g.id)) continue
  const settings = g.settings
    .filter(s => !s.risky && s.kobo_clara_bw !== false && !SKIP_KEYS.has(s.key) && !isTableValue(s))
    .filter(s => s.type !== 'enum' || (s.options ?? []).length > 0)
    .map(s => clean(s, g))
  const id = GROUP_ID[g.id] ?? g.id
  if (settings.length) groups.push({ id, label: GROUP_LABEL[id] ?? g.label.replace(/\s*\(.*\)\s*$/, '').replace(/ — .*$/, ''), settings })
}

// Project: Title (its own SQLite config; takes effect after a restart).
const PT_MODES = [
  { value: 'list_image_meta', label: 'Cover list' }, { value: 'mosaic_image', label: 'Cover grid' },
  { value: 'list_only_meta', label: 'Details list' }, { value: 'list_no_meta', label: 'File names' },
]
const pt = src.project_title.settings
  .filter(s => s.key !== 'config_version' && s.key !== 'series_mode' && ['bool', 'int', 'enum'].includes(s.type))
  .map(s => {
    const def = {
      key: `pt:${s.key}`, label: s.label, path: 'Project: Title → Settings', type: s.type,
      absent: s.type === 'bool' ? (s.default ?? false) : (s.default ?? null), effect: 'restart',
      source: `projecttitle.koplugin/${s.source}`,
    }
    if (s.type === 'enum') def.options = PT_MODES
    if (s.min !== undefined) def.min = s.min
    if (s.max !== undefined) def.max = s.max
    return def
  })
groups.splice(2, 0, { id: 'project_title', label: 'Library (Project: Title)', settings: pt })

const total = groups.reduce((t, g) => t + g.settings.length, 0)
const body = `// GENERATED by scripts/kobo/gen-settings-catalogue.mjs from docs/kobo/koreader-settings.json —
// do not edit by hand. ${total} settings in ${groups.length} groups, each read from KOReader
// v2026.07.1's source (\`source\` = file:line). Also GENERATED into supabase/functions/kobo-sync
// with koboSettings.ts. \`absent\` is what KOReader does when the key is not set at all.

export interface SettingOption { value: string | number | boolean; label: string }

export interface SettingDef {
  key: string
  label: string
  /** Where KOReader shows it, for "find it on the Kobo". */
  path: string
  type: 'bool' | 'enum' | 'int' | 'number' | 'string'
  absent: boolean | number | string | null
  options?: SettingOption[]
  min?: number
  max?: number
  step?: number
  unit?: string
  maxLength?: number
  /** When the Kobo starts using a new value. */
  effect: 'immediate' | 'next_sleep' | 'next_book' | 'restart'
  help?: string
  /** Set by the plugin itself (e.g. the sleep image folder), never from the app directly. */
  managed?: boolean
  source: string
}

export interface SettingGroup { id: string; label: string; settings: SettingDef[] }

export const SETTING_GROUPS: SettingGroup[] = [
${groups.map(g => `  {
    id: ${JSON.stringify(g.id)}, label: ${JSON.stringify(g.label)},
    settings: [
${g.settings.map(d => `      ${JSON.stringify(d)},`).join('\n')}
    ],
  },`).join('\n')}
]
`
let prev = ''
try { prev = readFileSync(TARGET, 'utf8') } catch { /* first run */ }
if (prev === body) { console.log('already up to date'); process.exit(0) }
if (process.argv.includes('--check')) { console.error('koboSettingsCatalogue.ts is stale — run node scripts/kobo/gen-settings-catalogue.mjs'); process.exit(1) }
writeFileSync(TARGET, body)
console.log(`koboSettingsCatalogue.ts: ${total} settings in ${groups.length} groups`)
