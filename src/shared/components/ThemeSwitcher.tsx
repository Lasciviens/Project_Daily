import { useState } from 'react'

const THEMES: Record<string, { label: string; hex: string; vars: Record<string, string> }> = {
  orange: {
    label: 'Orange',
    hex: '#f59e0b',
    vars: { '50':'255 251 235', '100':'254 243 199', '200':'253 230 138', '400':'251 191 36', '500':'245 158 11', '600':'217 119 6', '700':'180 83 9' },
  },
  red: {
    label: 'Red',
    hex: '#ef4444',
    vars: { '50':'255 241 242', '100':'255 228 230', '200':'254 202 202', '400':'248 113 113', '500':'239 68 68', '600':'220 38 38', '700':'185 28 28' },
  },
  blue: {
    label: 'Blue',
    hex: '#3b82f6',
    vars: { '50':'239 246 255', '100':'219 234 254', '200':'191 219 254', '400':'96 165 250', '500':'59 130 246', '600':'37 99 235', '700':'29 78 216' },
  },
  purple: {
    label: 'Purple',
    hex: '#8b5cf6',
    vars: { '50':'245 243 255', '100':'237 233 254', '200':'221 214 254', '400':'167 139 250', '500':'139 92 246', '600':'124 58 237', '700':'109 40 217' },
  },
  yellow: {
    label: 'Yellow',
    hex: '#eab308',
    vars: { '50':'254 252 232', '100':'254 249 195', '200':'254 240 138', '400':'250 204 21', '500':'234 179 8', '600':'202 138 4', '700':'161 98 7' },
  },
  black: {
    label: 'Black',
    hex: '#1f2937',
    vars: { '50':'249 250 251', '100':'243 244 246', '200':'229 231 235', '400':'156 163 175', '500':'31 41 55', '600':'17 24 39', '700':'9 14 23' },
  },
}

export function applyTheme(name: string) {
  const theme = THEMES[name]
  if (!theme) return
  const root = document.documentElement
  Object.entries(theme.vars).forEach(([shade, value]) => {
    root.style.setProperty(`--accent-${shade}`, value)
  })
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(
    () => localStorage.getItem('accent-theme') ?? 'orange'
  )

  function select(name: string) {
    applyTheme(name)
    localStorage.setItem('accent-theme', name)
    setCurrent(name)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(p => !p)}
        title="Change accent color"
        className="w-5 h-5 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-shadow duration-150 flex-shrink-0"
        style={{ backgroundColor: THEMES[current]?.hex }}
      />

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-50 bg-white border border-ink-200 rounded-xl shadow-card-hover p-2.5 flex items-center gap-2">
            {Object.entries(THEMES).map(([name, t]) => (
              <button
                key={name}
                onClick={() => select(name)}
                title={t.label}
                className={`w-5 h-5 rounded-full border-2 transition-shadow duration-150 hover:scale-110 ${
                  current === name ? 'border-ink-500 scale-110' : 'border-transparent'
                }`}
                style={{ backgroundColor: t.hex }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
