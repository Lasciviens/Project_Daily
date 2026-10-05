import { Tablet } from 'lucide-react'
import { TonePill, Truncate } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { READ_STATUS_LABEL, READ_STATUS_TONE } from '../bookTones'
import type { Book } from '../types'
import { BookCover } from './BookCover'

/** A cover tile in the library grid: tap opens the book. */
export function BookTile({ book, showStatus = true }: { book: Book; showStatus?: boolean }) {
  const modal = useEntityModal()
  const pct = book.progress_pct ?? 0
  return (
    <button type="button" onClick={() => modal.open({ kind: 'book', id: book.id })}
      className="group flex w-full min-w-0 flex-col gap-1.5 rounded-control text-left transition-transform active:scale-[0.98]">
      <div className="relative w-full">
        <BookCover book={book} className="w-full transition-shadow group-hover:shadow-md" />
        {book.read_status === 'reading' && pct > 0 && (
          <div className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-surface/80">
            <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <Truncate as="p" lines={2} className="text-meta font-semibold leading-snug text-fg">{book.title}</Truncate>
        {book.author && <Truncate as="p" className="text-micro text-fg-muted">{book.author}</Truncate>}
        {(showStatus || book.on_device) && (
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {showStatus && book.read_status && <TonePill tone={READ_STATUS_TONE[book.read_status]}>{READ_STATUS_LABEL[book.read_status]}</TonePill>}
            {book.on_device && <span className="inline-flex items-center gap-0.5 text-micro text-fg-muted" title="On the Kobo"><Tablet className="h-3 w-3" aria-hidden />Kobo</span>}
          </span>
        )}
      </div>
    </button>
  )
}
