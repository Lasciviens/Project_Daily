import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { sanitizeDecimal } from './foodLogUtils'
import { parseQuickAdd } from '../foodSearch'

export interface QuickAddValues {
  title:     string
  calories:  number | null
  protein_g: number | null
  carbs_g:   number | null
  fat_g:     number | null
}

interface Props {
  query:  string
  busy:   boolean
  onLog:  (v: QuickAddValues) => void
}

// A one-off diary line (custom_title + typed macros) — the common case for a
// meal eaten out ("Kebab ~700 kcal") that should never become a library
// ingredient. Typing a number after the name ("kebab 700") pre-fills kcal, so
// that case is a single tap on Log.
export function QuickAddCustom({ query, busy, onLog }: Props) {
  const parsed = parseQuickAdd(query)
  const [open, setOpen] = useState(parsed.kcal != null)
  const [title, setTitle] = useState(parsed.title)
  const [kcal, setKcal] = useState(parsed.kcal != null ? String(parsed.kcal) : '')
  const [prot, setProt] = useState('')
  const [carb, setCarb] = useState('')
  const [fat, setFat] = useState('')

  // Follow the search box while the user keeps typing (adjust-during-render).
  const [seenQuery, setSeenQuery] = useState(query)
  if (query !== seenQuery) {
    setSeenQuery(query)
    setTitle(parsed.title)
    if (parsed.kcal != null) { setKcal(String(parsed.kcal)); setOpen(true) }
  }

  const num = (s: string) => (s === '' ? null : Number(s))

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="row row-interactive min-h-[52px] px-1 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600"><Zap className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-accent-700">Quick add “{parsed.title}”</span>
          <span className="block text-meta text-fg-muted">A one-off line with just calories — no ingredient saved</span>
        </span>
      </button>
    )
  }

  return (
    <form
      className="my-1 flex flex-col gap-2 rounded-card border border-accent-500/25 bg-accent-50 p-3"
      onSubmit={e => {
        e.preventDefault()
        if (!title.trim()) return
        onLog({ title: title.trim(), calories: num(kcal), protein_g: num(prot), carbs_g: num(carb), fat_g: num(fat) })
      }}
    >
      <p className="flex items-center gap-1.5 text-meta font-semibold text-accent-700"><Zap className="h-3.5 w-3.5" aria-hidden /> Quick add · one-off</p>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What did you eat?" aria-label="Title" className="input" />
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { v: kcal, set: setKcal, ph: 'kcal' },
          { v: prot, set: setProt, ph: 'Protein' },
          { v: carb, set: setCarb, ph: 'Carbs' },
          { v: fat,  set: setFat,  ph: 'Fat' },
        ].map(m => (
          <input key={m.ph} value={m.v} onChange={e => m.set(sanitizeDecimal(e.target.value))} inputMode="decimal"
            placeholder={m.ph} aria-label={m.ph === 'kcal' ? 'Calories' : `${m.ph} (g)`} className="input px-2 tabular-nums" />
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" variant="primary" block loading={busy} disabled={!title.trim()}>
          Log{kcal ? ` ${Math.round(Number(kcal))} kcal` : ''}
        </Button>
      </div>
    </form>
  )
}
