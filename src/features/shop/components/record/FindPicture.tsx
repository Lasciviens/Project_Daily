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
export function FindPicture({ item, pages, named, categories, onUse, saving = false }: {
  item: ShopItem
  pages: readonly string[]
  named?: boolean
  categories: readonly ShopCategory[]
  /** The owner took it: the add's draft takes it as a fact; a saved thing writes it with Undo. */
  onUse: (p: PagePicture) => void
  saving?: boolean
}) {
  const f = useFindPicture({ item, pages, named, categories })
  const cost = f.worstUsd != null ? `≤ $${f.worstUsd < 0.01 ? f.worstUsd.toFixed(3) : f.worstUsd.toFixed(2)}` : null
  const tip = f.free
    ? 'Find a picture on its own page — free'
    : `Search the web for its picture with AI${cost ? ` — at most ${cost.slice(2)}` : ''}`
  if (f.found?.image) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label="Picture found">
        <ItemThumb src={f.found.image} />
        <span className="min-w-0 flex-1 text-meta text-fg-muted">From {f.found.host ?? 'its page'}{f.costUsd != null ? ` · ${costNote(f.costUsd)}` : ''}</span>
        <Button size="sm" variant="primary" icon={<Check />} loading={saving} onClick={() => { if (f.found) onUse(f.found); f.dismiss() }} tip="Use this picture">Use</Button>
        <IconButton size="sm" label="Not this picture" onClick={f.dismiss}><X aria-hidden /></IconButton>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button size="sm" variant="ghost" icon={<ImageDown />} loading={f.busy} disabled={!item.title.trim()} onClick={() => { void f.find() }} tip={tip}>
        {f.free ? 'Picture' : cost ? `Picture · ${cost}` : 'Picture'}
      </Button>
      {f.found?.note && <span className="text-meta text-fg-muted" role="status">{f.found.note}{f.costUsd != null ? ` · ${costNote(f.costUsd)}` : ''}</span>}
    </div>
  )
}
