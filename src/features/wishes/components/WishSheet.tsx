import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
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
    <ModalShell
      onClose={onClose}
      title="Edit wish"
      size="md"
      dismissible={!update.isPending}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="ml-auto" onClick={save} loading={update.isPending} disabled={!draft.title.trim()}>
            Save wish
          </Button>
        </div>
      }
    >
      <WishForm draft={draft} onChange={patch => setDraft(d => ({ ...d, ...patch }))} />
    </ModalShell>
  )
}
