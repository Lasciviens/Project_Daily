// Which fonts a font setting can pick from — pure, verified by
// scripts/verify-kobo-settings.cjs. The Kobo reports its own list (plugin 1.3:
// report.fonts); until it has, the fonts that ship with KOReader v2026.07.1
// (resources/fonts = koreader-fonts @ 0469769) are offered.

import type { SettingDef } from '../koboSettingsCatalogue'

/** One font file KOReader knows (FontList.fontinfo, frontend/fontlist.lua). */
export interface FontFile {
  /** The path KOReader stores, e.g. "./fonts/noto/NotoSans-Regular.ttf". */
  file: string
  /** The family name inside the file. */
  name: string
  bold?: boolean
  italic?: boolean
}

/** What the plugin reports (report.fonts). */
export interface FontReport {
  /** crengine's face names (cre.getFontFaces(), what the reader's font menu lists). */
  faces?: string[]
  files?: FontFile[]
}

/**
 * The face names crengine registers from KOReader's bundled fonts: every file in
 * ./fonts except urw/ and nerdfonts/symbols.ttf (frontend/document/credocument.lua:121-129).
 */
export const BUNDLED_FACES: string[] = [
  'Droid Sans Mono', 'FreeSans', 'FreeSerif', 'Noto Naskh Arabic', 'Noto Sans', 'Noto Sans Arabic UI',
  'Noto Sans Bengali UI', 'Noto Sans CJK SC', 'Noto Sans Devanagari UI', 'Noto Serif',
]

/** The bundled files the status bar's font chooser lists (FontList reads all of ./fonts). */
export const BUNDLED_FILES: FontFile[] = [
  { file: './fonts/droid/DroidSansMono.ttf', name: 'Droid Sans Mono' },
  { file: './fonts/freefont/FreeSans.ttf', name: 'FreeSans' },
  { file: './fonts/freefont/FreeSerif.ttf', name: 'FreeSerif' },
  { file: './fonts/noto/NotoSans-Regular.ttf', name: 'Noto Sans' },
  { file: './fonts/noto/NotoSans-Bold.ttf', name: 'Noto Sans', bold: true },
  { file: './fonts/noto/NotoSans-Italic.ttf', name: 'Noto Sans', italic: true },
  { file: './fonts/noto/NotoSans-BoldItalic.ttf', name: 'Noto Sans', bold: true, italic: true },
  { file: './fonts/noto/NotoSerif-Regular.ttf', name: 'Noto Serif' },
  { file: './fonts/noto/NotoSerif-Bold.ttf', name: 'Noto Serif', bold: true },
  { file: './fonts/noto/NotoSerif-Italic.ttf', name: 'Noto Serif', italic: true },
  { file: './fonts/noto/NotoSerif-BoldItalic.ttf', name: 'Noto Serif', bold: true, italic: true },
]

export interface FontOption {
  value: string
  label: string
  /** A CSS font-family to preview the name in, when the browser may have it. */
  family?: string
}

export interface FontChoices {
  options: FontOption[]
  /** The list came from the Kobo (false = the bundled fonts). */
  fromKobo: boolean
}

/** A file's label: "Noto Sans bold italic" (FontChooser.getFontNameText's shape). */
export function fileLabel(f: FontFile): string {
  return [f.name, f.bold ? 'bold' : '', f.italic ? 'italic' : ''].filter(Boolean).join(' ')
}

const cleanList = (xs: unknown): string[] =>
  Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200))] : []

function cleanFiles(xs: unknown): FontFile[] {
  if (!Array.isArray(xs)) return []
  const seen = new Set<string>()
  const out: FontFile[] = []
  for (const x of xs) {
    const f = x as Partial<FontFile> | null
    if (!f || typeof f.file !== 'string' || !f.file || f.file.length > 300 || seen.has(f.file)) continue
    seen.add(f.file)
    out.push({ file: f.file, name: typeof f.name === 'string' && f.name ? f.name : f.file.replace(/^.*\//, ''), bold: !!f.bold, italic: !!f.italic })
  }
  return out
}

/**
 * The picker's options for a font setting, sorted by name. The current value
 * stays listed even when the list lacks it (marked "not on the Kobo"), so
 * nothing is silently changed.
 */
export function fontChoices(def: Pick<SettingDef, 'font'>, report: FontReport | null | undefined, current?: string | null): FontChoices {
  const byName = (a: FontOption, b: FontOption) => a.label.localeCompare(b.label, 'en')
  let options: FontOption[]
  let fromKobo: boolean
  if (def.font === 'file') {
    const files = cleanFiles(report?.files)
    fromKobo = files.length > 0
    options = (fromKobo ? files : BUNDLED_FILES).map(f => ({ value: f.file, label: fileLabel(f), family: f.name }))
  } else {
    const faces = cleanList(report?.faces)
    fromKobo = faces.length > 0
    options = (fromKobo ? faces : BUNDLED_FACES).map(f => ({ value: f, label: f, family: f }))
  }
  options.sort(byName)
  if (current && !options.some(o => o.value === current)) {
    options.unshift({ value: current, label: `${def.font === 'file' ? current.replace(/^.*\//, '') : current} (not on the Kobo)` })
  }
  return { options, fromKobo }
}

/** A CSS font-family list for a preview: the font itself, then the nearest generic family. */
export function previewFamily(name: string | undefined): string | undefined {
  if (!name) return undefined
  const generic = /mono/i.test(name) ? 'monospace' : /serif/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif'
  return `"${name.replace(/["\\]/g, '')}", ${generic}`
}
