import { useState } from 'react'
import { WindowChips } from '../../../shared/components/windowChips'
import { useCreateWish } from '../hooks/useWishes'

interface PeriodValue { start: string | null; end: string | null; label: string | null }
const NO_PERIOD: PeriodValue = { start: null, end: null, label: null }

// Capture is the point of this page, so it is always visible and never behind a
// "+ New" modal: type a title, optionally tap one season chip, Add. A wish with
// NO period is deliberately one tap fewer than one with a season — the chips
// are an option, not a step, and nothing here can turn into a deadline.
// Everything else (notes, place, priority, kind) lives in the edit sheet.
export function WishQuickAdd() {
  const [title, setTitle]   = useState('')
  const [period, setPeriod] = useState<PeriodValue>(NO_PERIOD)
  const create = useCreateWish()
  const canSave = title.trim().length > 0 && !create.isPending

  function add() {
    if (!canSave) return
    create.mutate(
      {
        title:        title.trim(),
        period_start: period.start,
        period_end:   period.end,
        period_label: period.label,
      },
      // Only the title clears: keeping the period lets a whole season's worth of
      // wishes go in one after another with a single chip tap up front.
      { onSuccess: () => setTitle('') },
    )
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); add() }}
      className="max-w-xl rounded-2xl border border-ink-200 bg-cream-50 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Something you want to do…"
          aria-label="Wish"
          className="min-h-[44px] flex-1 min-w-[11rem] max-w-md rounded-xl border border-ink-200 bg-canvas px-3 text-sm text-ink-900 placeholder:text-ink-400"
        />
        <button
          type="submit"
          disabled={!canSave}
          className="press-feedback min-h-[44px] rounded-xl bg-accent-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      <WindowChips value={period} onChange={setPeriod} className="mt-3" />
    </form>
  )
}
