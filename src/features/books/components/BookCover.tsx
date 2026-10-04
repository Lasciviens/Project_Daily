import { useState } from 'react'
import { cx } from '../../../shared/ui'
import type { Book } from '../types'

// Callers give the width (w-full in a grid, w-8 in a row). A cover, or a drawn one: title and author on a quiet tinted card, so a
// library without covers still reads as books, not as grey boxes.
export function BookCover({ book, className, size = 'md' }: {
  book: Pick<Book, 'title' | 'author' | 'cover_url'>
  className?: string
  size?: 'sm' | 'md'
}) {
  const [failed, setFailed] = useState(false)
  if (book.cover_url && !failed) {
    return (
      <img src={book.cover_url} alt="" loading="lazy" onError={() => setFailed(true)}
        className={cx('aspect-[2/3] rounded-[6px] border border-line bg-surface-2 object-cover', className)} />
    )
  }
  if (size === 'sm') {
    // Too small for a title: the first letter, on the same quiet card.
    return (
      <div aria-hidden className={cx('grid aspect-[2/3] place-items-center rounded-[4px] border border-line bg-accent-50 text-meta font-bold text-accent-700', className)}>
        {[...book.title.trim()][0]?.toUpperCase() ?? '?'}
      </div>
    )
  }
  return (
    <div aria-hidden className={cx('flex aspect-[2/3] flex-col justify-between overflow-hidden rounded-[6px] border border-line bg-accent-50 p-2', className)}>
      {/* Decorative (aria-hidden; the title is printed beside every cover), so clipped, not truncated. */}
      <span className="max-h-[70%] overflow-hidden text-meta font-semibold leading-tight text-accent-800 break-words">{book.title}</span>
      {book.author && <span className="max-h-[2.6em] overflow-hidden text-micro text-accent-700">{book.author}</span>}
    </div>
  )
}
