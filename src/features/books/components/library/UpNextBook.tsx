import { Tablet } from 'lucide-react'
import { Truncate, cx } from '../../../../shared/ui'
import type { Book } from '../../types'
import { BookCover } from '../BookCover'

/** One book of Up next — its number, cover, title and where it is — with or without the drag (UpNextList). */
export function UpNextBook({ book: b, place, dragging = false, onOpen }: { book: Book; place: number; dragging?: boolean; onOpen: () => void }) {
  return (
    <>
      {/* While a book is dragged every row shows the number it gets if it drops now. */}
      <span className="w-5 shrink-0 text-right text-meta tabular-nums text-fg-faint">{place + 1}</span>
      <button type="button" onClick={onOpen} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        className={cx('flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left', !dragging && 'hover:bg-surface-hover')}>
        <BookCover book={b} size="sm" className="w-8 shrink-0" />
        <span className="min-w-0">
          <Truncate as="span" className="block text-body font-medium text-fg">{b.title}</Truncate>
          <span className="flex flex-wrap items-center gap-x-2 text-micro text-fg-muted">
            {b.author && <Truncate as="span" className="min-w-0 max-w-full">{b.author}</Truncate>}
            {b.on_device
              ? <span className="inline-flex items-center gap-0.5 text-success"><Tablet className="h-3 w-3" aria-hidden />On the Kobo</span>
              : <span>Not on the Kobo</span>}
          </span>
        </span>
      </button>
    </>
  )
}
