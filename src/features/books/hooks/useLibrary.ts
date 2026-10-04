import { useQuery } from '@tanstack/react-query'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import {
  createBook, deleteBook, fetchBooks, fetchReadingEvents, fetchReadingSettings, lookupBookMeta, mergeBooks,
  READING_DEFAULTS, saveQueueOrder, saveReadingSettings, updateBook,
} from '../api/libraryApi'
import { addDays, localDay } from '../readingAggregate'
import type { Book, BookPatch, ReadingSettings } from '../types'

const libraryQuery = { queryKey: qk.books.library(), queryFn: fetchBooks, staleTime: STALE.default }

export function useLibrary(enabled = true) {
  return useQuery({ ...libraryQuery, enabled })
}

/** One book, narrowed from the shared library query (one request for every surface). */
export function useBook(id: string) {
  return useQuery({ ...libraryQuery, select: (rows: Book[]) => rows.find(b => b.id === id) ?? null })
}

/** The first day of the reading window: `days` back from today, local midnight. */
export function windowStart(days: number): string {
  const day = addDays(localDay(new Date()), -(days - 1))
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** Page events of the last `days` days (one shared query per window). */
export function useReadingEvents(days: number, enabled = true) {
  const from = windowStart(days)
  return useQuery({
    queryKey: qk.books.events(from.slice(0, 10) + `:${days}`),
    queryFn: () => fetchReadingEvents(from),
    staleTime: STALE.default,
    enabled,
  })
}

export function useBookEvents(bookId: string) {
  return useQuery({
    queryKey: qk.books.bookEvents(bookId),
    queryFn: () => fetchReadingEvents('2000-01-01T00:00:00Z', bookId),
    staleTime: STALE.default,
  })
}

export function useReadingSettings() {
  return useQuery({ queryKey: qk.books.settings(), queryFn: fetchReadingSettings, staleTime: STALE.default, placeholderData: READING_DEFAULTS })
}

export function useSaveReadingSettings() {
  return useMutationWithFeedback({
    action: 'reading_settings_save',
    mutationFn: (s: ReadingSettings) => saveReadingSettings(s),
    successMessage: 'Reading goal saved',
    invalidates: [qk.books.settings()],
  })
}

export function useUpdateBook() {
  return useMutationWithFeedback({
    action: 'book_update',
    mutationFn: ({ id, patch }: { id: string; patch: BookPatch }) => updateBook(id, patch),
    invalidates: [qk.books.library()],
  })
}

/** Status change with the started/finished stamps filled once, never overwritten. */
export function statusPatch(book: Book, status: Book['read_status']): BookPatch {
  const now = new Date().toISOString()
  const patch: BookPatch = { read_status: status }
  if ((status === 'reading' || status === 'finished') && !book.started_at) patch.started_at = book.last_read_at ?? now
  if (status === 'finished' && !book.finished_at) patch.finished_at = book.last_read_at ?? now
  return patch
}

export function useCreateBook() {
  return useMutationWithFeedback({
    action: 'book_create',
    mutationFn: (row: { title: string; author?: string | null; read_status?: Book['read_status'] }) => createBook(row),
    successMessage: 'Book added',
    invalidates: [qk.books.library()],
  })
}

export function useDeleteBook() {
  return useMutationWithFeedback({
    action: 'book_delete',
    mutationFn: (id: string) => deleteBook(id),
    successMessage: 'Book deleted',
    invalidates: [qk.books.all],
  })
}

export function useSaveQueueOrder() {
  return useMutationWithFeedback({
    action: 'book_queue_order',
    mutationFn: (rows: { id: string; queue_order: number }[]) => saveQueueOrder(rows),
    invalidates: [qk.books.library()],
  })
}

export function useMergeBooks() {
  return useMutationWithFeedback({
    action: 'book_merge',
    mutationFn: ({ survivor, loser }: { survivor: Book; loser: Book }) => mergeBooks(survivor, loser),
    loadingMessage: 'Merging…',
    successMessage: 'Merged into one book',
    invalidates: [qk.books.all],
  })
}

export function useLookupBookMeta() {
  return useMutationWithFeedback({
    action: 'book_meta_lookup',
    mutationFn: (id: string) => lookupBookMeta(id),
    loadingMessage: 'Looking up the book…',
    successMessage: r => r.updated.length ? `Updated ${r.updated.join(', ')} from ${r.source}` : 'Nothing new found',
    invalidates: [qk.books.library()],
  })
}
