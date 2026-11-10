// ─────────────────────────────────────────────────────────────────────────────
//  A compact sheet's optional rows (THEME §8 → Compact sheet pieces): they wait
//  as "+ Notes" text buttons (AddFact) and open in place as a FactRow — a short
//  label beside its field. Used by the supplements' schedule sheet; the item
//  screen has rows of its own (ItemRows.tsx).
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { chipClass } from './fieldStyles'

/** "+ Notes": opens an optional row in place. */
export function AddFact({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={chipClass('quiet')}>
      <Plus aria-hidden />{label}
    </button>
  )
}

/** An opened optional row: a short label beside its field, not an uppercase label above it. */
export function FactRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-2">
      <Label htmlFor={htmlFor} className="flex h-8 items-center text-meta text-fg-muted">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
