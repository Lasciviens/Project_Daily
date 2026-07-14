// Each named accent theme carries a light AND dark variant. Real bug this
// fixes: applyTheme() sets --accent-* as INLINE styles on <html> (so the
// user's picked accent color survives every reload, applied once on app
// mount by Providers.tsx) — inline styles win over ANY stylesheet rule
// regardless of selector specificity, so index.css's `:root.dark
// { --accent-*: ... }` override could never actually take effect; accent
// stayed locked to its light-mode inline value in dark mode no matter what
// the stylesheet said (this is what made the Daily Brief/FocusStrip cards
// unreadable in dark mode even after giving accent its own dark values).
export const THEMES: Record<string, { label: string; hex: string; vars: Record<string, string>; darkVars: Record<string, string> }> = {
  orange: {
    label: 'Orange',
    hex: '#f59e0b',
    vars:     { '50':'255 251 235', '100':'254 243 199', '200':'253 230 138', '400':'251 191 36', '500':'245 158 11', '600':'217 119 6', '700':'180 83 9' },
    darkVars: { '50':'46 36 20',    '100':'56 43 22',    '200':'77 56 24',    '400':'217 142 45', '500':'230 155 45', '600':'199 130 35', '700':'168 108 30' },
  },
  red: {
    label: 'Red',
    hex: '#ef4444',
    vars:     { '50':'255 241 242', '100':'255 228 230', '200':'254 202 202', '400':'248 113 113', '500':'239 68 68', '600':'220 38 38', '700':'185 28 28' },
    darkVars: { '50':'42 20 20',    '100':'54 24 24',    '200':'74 30 30',    '400':'240 120 120', '500':'229 90 90', '600':'204 60 60', '700':'179 40 40' },
  },
  blue: {
    label: 'Blue',
    hex: '#3b82f6',
    vars:     { '50':'239 246 255', '100':'219 234 254', '200':'191 219 254', '400':'96 165 250',  '500':'59 130 246', '600':'37 99 235',  '700':'29 78 216' },
    darkVars: { '50':'20 28 42',    '100':'24 35 54',    '200':'30 48 74',    '400':'110 165 240', '500':'80 140 230', '600':'55 115 210', '700':'40 95 185' },
  },
  purple: {
    label: 'Purple',
    hex: '#8b5cf6',
    vars:     { '50':'245 243 255', '100':'237 233 254', '200':'221 214 254', '400':'167 139 250', '500':'139 92 246', '600':'124 58 237', '700':'109 40 217' },
    darkVars: { '50':'32 26 42',    '100':'40 33 54',    '200':'55 45 74',    '400':'175 150 240', '500':'150 110 230', '600':'135 85 215', '700':'120 65 195' },
  },
  yellow: {
    label: 'Yellow',
    hex: '#eab308',
    vars:     { '50':'254 252 232', '100':'254 249 195', '200':'254 240 138', '400':'250 204 21',  '500':'234 179 8',  '600':'202 138 4',  '700':'161 98 7' },
    darkVars: { '50':'42 38 18',    '100':'54 48 20',    '200':'74 65 25',    '400':'220 175 45', '500':'210 160 35', '600':'185 135 30', '700':'155 110 25' },
  },
  black: {
    label: 'Black',
    hex: '#1f2937',
    vars:     { '50':'249 250 251', '100':'243 244 246', '200':'229 231 235', '400':'156 163 175', '500':'31 41 55',  '600':'17 24 39',  '700':'9 14 23' },
    darkVars: { '50':'30 33 38',    '100':'38 41 46',    '200':'50 54 61',    '400':'180 186 196', '500':'140 148 163', '600':'100 110 130', '700':'70 80 100' },
  },
}

export function applyTheme(name: string) {
  const theme = THEMES[name]
  if (!theme) return
  const root = document.documentElement
  const isDark = root.classList.contains('dark')
  const set = isDark ? theme.darkVars : theme.vars
  Object.entries(set).forEach(([shade, value]) => {
    root.style.setProperty(`--accent-${shade}`, value)
  })
}

