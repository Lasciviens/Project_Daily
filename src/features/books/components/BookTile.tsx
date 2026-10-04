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
          <div className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <Truncate as="p" lines={2} className="text-meta font-semibold leading-snug text-fg">{book.title}</Truncate>
        {book.author && <Truncate as="p" className="text-micro text-fg-muted">{book.author}</Truncate>}
        {showStatus && (
          <span className="mt-1 inline-flex"><TonePill tone={READ_STATUS_TONE[book.read_status]}>{READ_STATUS_LABEL[book.read_status]}</TonePill></span>
        )}
      </div>
    </button>
  )
}
