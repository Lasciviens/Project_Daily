// Accent presets — the one place accent colours are defined.
//
// Every preset carries a FULL 50–950 scale for light and dark (Tailwind's
// accent-* classes resolve through --accent-<shade> CSS variables), plus the
// text colour that sits on a filled accent surface (--on-accent). A missing
// shade renders nothing at all (Tailwind emits no rule for an undefined key),
// which is how 105 uses of accent-300/800 once silently did nothing.
//
// applyAccent() writes the variables as inline styles on <html>. Inline
// styles beat any stylesheet rule, so the light/dark variant must be picked
// here (by reading the .dark class) rather than by a :root.dark rule — and it
// must be re-run whenever light/dark flips (useThemeStore does that).

export type AccentName = 'blue' | 'orange' | 'red' | 'purple' | 'yellow' | 'slate'

export interface AccentPreset {
  label: string
  /** Swatch colour shown in the picker. */
  hex: string
  /** RGB triplet for text/icons on a filled accent surface, light and dark. */
  onAccent: string
  onAccentDark: string
  vars: Record<string, string>
  darkVars: Record<string, string>
}

export const DEFAULT_ACCENT: AccentName = 'blue'

export const ACCENTS: Record<AccentName, AccentPreset> = {
  blue: { label: 'Blue', hex: '#2563eb', onAccent: '255 255 255', onAccentDark: '255 255 255', vars: { '50':'239 244 255', '100':'219 231 254', '200':'191 212 254', '300':'147 181 253', '400':'96 145 250', '500':'37 99 235', '600':'29 78 216', '700':'30 64 175', '800':'30 58 138', '900':'30 45 100', '950':'23 32 70' }, darkVars: { '50':'16 28 58', '100':'21 42 92', '200':'31 61 134', '300':'52 94 196', '400':'75 128 255', '500':'47 107 255', '600':'75 128 255', '700':'147 178 255', '800':'180 200 255', '900':'210 222 255', '950':'230 237 255' } },
  orange: { label: 'Orange', hex: '#f59e0b', onAccent: '28 25 23', onAccentDark: '10 12 20', vars: { '50':'255 251 235', '100':'254 243 199', '200':'253 230 138', '300':'252 210 87', '400':'251 191 36', '500':'245 158 11', '600':'217 119 6', '700':'180 83 9', '800':'138 65 12', '900':'104 51 14', '950':'70 37 16' }, darkVars: { '50':'46 36 20', '100':'56 43 22', '200':'77 56 24', '300':'147 99 34', '400':'217 142 45', '500':'230 155 45', '600':'199 130 35', '700':'230 182 118', '800':'198 159 109', '900':'220 196 165', '950':'238 226 210' } },
  red: { label: 'Red', hex: '#ef4444', onAccent: '255 255 255', onAccentDark: '255 255 255', vars: { '50':'255 241 242', '100':'255 228 230', '200':'254 202 202', '300':'251 158 158', '400':'248 113 113', '500':'239 68 68', '600':'220 38 38', '700':'185 28 28', '800':'141 24 26', '900':'106 21 24', '950':'71 18 23' }, darkVars: { '50':'42 20 20', '100':'54 24 24', '200':'74 30 30', '300':'157 75 75', '400':'240 120 120', '500':'229 90 90', '600':'204 60 60', '700':'245 167 167', '800':'206 115 115', '900':'225 169 169', '950':'240 212 212' } },
  purple: { label: 'Purple', hex: '#8b5cf6', onAccent: '255 255 255', onAccentDark: '255 255 255', vars: { '50':'245 243 255', '100':'237 233 254', '200':'221 214 254', '300':'194 176 252', '400':'167 139 250', '500':'139 92 246', '600':'124 58 237', '700':'109 40 217', '800':'84 33 168', '900':'64 27 128', '950':'45 22 89' }, darkVars: { '50':'32 26 42', '100':'40 33 54', '200':'55 45 74', '300':'115 98 157', '400':'175 150 240', '500':'150 110 230', '600':'135 85 215', '700':'203 187 245', '800':'167 132 216', '900':'201 179 231', '950':'228 217 243' } },
  yellow: { label: 'Yellow', hex: '#eab308', onAccent: '28 25 23', onAccentDark: '10 12 20', vars: { '50':'254 252 232', '100':'254 249 195', '200':'254 240 138', '300':'252 222 80', '400':'250 204 21', '500':'234 179 8', '600':'202 138 4', '700':'161 98 7', '800':'123 76 10', '900':'93 59 13', '950':'63 42 15' }, darkVars: { '50':'42 38 18', '100':'54 48 20', '200':'74 65 25', '300':'147 120 35', '400':'220 175 45', '500':'210 160 35', '600':'185 135 30', '700':'232 203 118', '800':'190 161 106', '900':'215 197 163', '950':'235 226 209' } },
  slate: { label: 'Slate', hex: '#334155', onAccent: '255 255 255', onAccentDark: '15 23 42', vars: { '50':'248 250 252', '100':'241 245 249', '200':'226 232 240', '300':'203 213 225', '400':'148 163 184', '500':'51 65 85', '600':'30 41 59', '700':'15 23 42', '800':'10 15 30', '900':'7 11 22', '950':'4 6 14' }, darkVars: { '50':'22 28 40', '100':'28 36 50', '200':'44 54 72', '300':'80 92 112', '400':'150 162 182', '500':'203 213 225', '600':'226 232 240', '700':'238 242 247', '800':'245 247 250', '900':'250 251 253', '950':'255 255 255' } },
}


/** A stored accent name from any older build → a preset that exists ('black' became 'slate'). */
export function resolveAccent(name: unknown): AccentName {
  if (name === 'black') return 'slate'
  return typeof name === 'string' && name in ACCENTS ? (name as AccentName) : DEFAULT_ACCENT
}

export function applyAccent(name: AccentName) {
  const preset = ACCENTS[resolveAccent(name)]
  const root = document.documentElement
  const dark = root.classList.contains('dark')
  const set = dark ? preset.darkVars : preset.vars
  for (const [shade, value] of Object.entries(set)) root.style.setProperty(`--accent-${shade}`, value)
  root.style.setProperty('--on-accent', dark ? preset.onAccentDark : preset.onAccent)
}
