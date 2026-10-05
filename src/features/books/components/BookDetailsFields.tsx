import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../../shared/ui'
import type { DetailsDraft } from './bookDetails'

const FIELDS: { key: keyof Omit<DetailsDraft, 'description'>; label: string; numeric?: boolean }[] = [
  { key: 'series_index', label: 'Number in series' },
  { key: 'language', label: 'Language' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'published_year', label: 'Year', numeric: true },
  { key: 'page_count', label: 'Pages', numeric: true },
  { key: 'isbn', label: 'ISBN' },
]

/** The book's details, folded away until wanted (it opens by itself when something is missing). */
export function BookDetailsFields({ draft, onChange }: { draft: DetailsDraft; onChange: (p: Partial<DetailsDraft>) => void }) {
  const missing = FIELDS.filter(f => !draft[f.key].trim()).length + (draft.description.trim() ? 0 : 1)
  const [open, setOpen] = useState(false)
  return (
    <section>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex min-h-[44px] w-full items-center gap-2 text-left">
        <span className="field-label mb-0 flex-1">Book details</span>
        {missing > 0 && <span className="text-micro text-fg-muted">{missing} missing</span>}
        <ChevronDown aria-hidden className={cx('h-4 w-4 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(f => (
              <label key={f.key} className="flex flex-col gap-1"><span className="field-label">{f.label}</span>
                <input className="input min-h-[44px]" inputMode={f.numeric ? 'numeric' : undefined} value={draft[f.key]}
                  onChange={e => onChange({ [f.key]: e.target.value })} /></label>
            ))}
          </div>
          <label className="flex flex-col gap-1"><span className="field-label">About the book</span>
            <textarea className="input min-h-[88px]" value={draft.description} onChange={e => onChange({ description: e.target.value })} /></label>
        </div>
      )}
    </section>
  )
}
