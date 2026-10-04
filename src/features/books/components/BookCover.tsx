import { useState } from 'react'
import { cx } from '../../../shared/ui'
import type { Book } from '../types'

// Callers give the width (w-full in a grid, w-8 in a row).
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
  // No cover: the first letter on a quiet card (the title is always printed
  // beside or under a cover, so it is not repeated inside it).
  return (
    <div aria-hidden className={cx('grid aspect-[2/3] place-items-center rounded-[6px] border border-line bg-accent-50 font-bold text-accent-700',
      size === 'sm' ? 'text-meta' : 'text-kpi', className)}>
      {[...book.title.trim()][0]?.toUpperCase() ?? '?'}
    </div>
  )
}
