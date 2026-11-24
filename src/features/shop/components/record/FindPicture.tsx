import { Check, ImageDown, X } from 'lucide-react'
import { Button, IconButton } from '../../../../shared/ui'
import { costNote } from '../../../ai/claude/featureRules'
import { ItemThumb } from '../shopKit'
import { useFindPicture } from './useFindPicture'
import type { PagePicture } from '../../productPicture'
import type { ShopCategory, ShopItem } from '../../types'

/**
 * Find picture, the one body's part in every mode: a short button (its own pages are free; the AI's search shows what it
 * can cost, "≤ $0.03"), then the picture as a suggestion with Use and No — nothing is written before Use. Its words when
 * there is none come from the shared `watchWords.pictureNote` ("finn.no doesn't let apps read its pages — no picture.").
 */
export function FindPicture({ item, pages, named, categories, onUse, saving = false, disabled = false }: {
  item: ShopItem
  pages: readonly string[]
  named?: boolean
  categories: readonly ShopCategory[]
  /** The owner took it: the add's draft takes it as a fact; a saved thing writes it with Undo. True once it is taken. */
  onUse: (p: PagePicture) => Promise<boolean>
  saving?: boolean
  /** While the thing is being saved. */
  disabled?: boolean
}) {
  const f = useFindPicture({ item, pages, named, categories })
  const cost = f.worstUsd != null ? `≤ $${f.worstUsd < 0.01 ? f.worstUsd.toFixed(3) : f.worstUsd.toFixed(2)}` : null
  const tip = f.free
    ? 'Picture: find one on its own page — free'
    : `Picture: search the web with AI${cost ? ` — at most ${cost.slice(2)}` : ' (working out the cost)'}`
  if (f.found?.image) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label="Picture found">
        <ItemThumb src={f.found.image} />
        <span className="min-w-0 flex-1 text-meta text-fg-muted">From {f.found.host ?? 'its page'}{f.costUsd != null ? ` · ${costNote(f.costUsd)}` : ''}</span>
        <Button size="sm" variant="primary" icon={<Check />} loading={saving} disabled={disabled} tip="Use this picture"
          onClick={() => { const p = f.found; if (p) void onUse(p).then(ok => { if (ok) f.done(true) }) }}>Use</Button>
        <IconButton size="sm" label="No, not this picture" disabled={disabled || saving} onClick={() => f.done(false)}><X aria-hidden /></IconButton>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* The paid search waits for its cost: the owner sees the most it can cost before the tap. */}
      <Button size="sm" variant="ghost" icon={<ImageDown />} loading={f.busy} disabled={disabled || !item.title.trim() || (!f.free && cost == null)} onClick={() => { void f.find() }} tip={tip}>
        {f.free ? 'Picture' : cost ? `Picture · ${cost}` : 'Picture'}
      </Button>
      {f.found?.note && <span className="text-meta text-fg-muted" role="status">{f.found.note}{f.costUsd != null ? ` · ${costNote(f.costUsd)}` : ''}</span>}
    </div>
  )
}
