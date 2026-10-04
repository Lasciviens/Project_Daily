import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending, useFirstLoaded } from '../../../shared/modals'
import { useBook } from '../hooks/useLibrary'
import { BookSheet } from '../components/BookSheet'

/** `book`: one book from the shared library query, by id. */
export function BookEntityModal({ request, onClose }: EntityModalProps<'book'>) {
  const query = useBook(request.id)
  const book = useFirstLoaded(query.data, query)
  if (!book) return <EntityModalPending query={query} what="book" onClose={onClose} />
  return <BookSheet book={book} onClose={onClose} />
}
