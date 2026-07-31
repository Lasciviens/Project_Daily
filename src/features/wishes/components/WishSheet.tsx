import { useState } from 'react'
import { Sheet } from '../../../shared/components/Sheet'
import { useUpdateWish } from '../hooks/useWishes'
import { WishForm, type WishDraft } from './WishForm'
import type { WishItem } from '../types'

function draftOf(w: WishItem): WishDraft {
  return {
    title:        w.title,
    notes:        w.notes ?? '',
    kind:         w.kind,
    priority:     w.priority,
    status:       w.status,
    city:         w.city ?? '',
    country:      w.country ?? '',
    url:          w.url ?? '',
    period_start: w.period_start,
    period_end:   w.period_end,
    period_label: w.period_label,
  }
}

// Mounted only while editing (keyed by the row's id at the call site), so the
// draft is seeded exactly once — a background refetch of ['wish-items'] can
// never overwrite what is being typed.
export function WishSheet({ wish, onClose }: { wish: WishItem; onClose: () => void }) {
  const update = useUpdateWish()
  const [draft, setDraft] = useState<WishDraft>(() => draftOf(wish))

  function save() {
    const title = draft.title.trim()
    if (!title) return
    update.mutate(
      {
        id: wish.id,
        patch: {
          title,
          notes:        draft.notes.trim() || null,
          kind:         draft.kind,
          priority:     draft.priority,
          status:       draft.status,
          city:         draft.city.trim() || null,
          country:      draft.country.trim() || null,
          url:          draft.url.trim() || null,
          period_start: draft.period_start,
          period_end:   draft.period_end,
          period_label: draft.period_label,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit wish"
      size="md"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="press-feedback min-h-[44px] rounded-xl border border-ink-200 px-4 text-sm font-medium text-ink-600 hover:bg-cream-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!draft.title.trim() || update.isPending}
            className="press-feedback ml-auto min-h-[44px] rounded-xl bg-accent-600 px-5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      }
    >
      <WishForm draft={draft} onChange={patch => setDraft(d => ({ ...d, ...patch }))} />
    </Sheet>
  )
}
