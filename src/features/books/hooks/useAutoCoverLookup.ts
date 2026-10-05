import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../../shared/query/keys'
import { logError } from '../../../shared/utils/logError'
import { lookupBookMeta } from '../api/libraryApi'
import type { Book } from '../types'

// Tried once per page load, a few at a time — never a burst against the libraries.
const tried = new Set<string>()
let running = false
const PER_VISIT = 5

/** A book that still has no cover once the Kobo had its turn (or is not on the Kobo) and was never looked up. */
export function needsOnlineCover(b: Book): boolean {
  return b.kind !== 'news' && !b.cover_url && !b.meta_checked_at && (!b.on_device || !!b.device_cover_at)
}

/**
 * Finds covers online (Nasjonalbiblioteket → Open Library) for books the Kobo
 * could not give one, quietly: the covers just appear.
 */
export function useAutoCoverLookup(books: Book[]) {
  const qc = useQueryClient()
  useEffect(() => {
    if (running) return
    const queue = books.filter(b => needsOnlineCover(b) && !tried.has(b.id)).slice(0, PER_VISIT - Math.min(PER_VISIT, tried.size))
    if (!queue.length) return
    running = true
    void (async () => {
      let found = 0
      for (const b of queue) {
        tried.add(b.id)
        try {
          const r = await lookupBookMeta(b.id)
          if (r.updated.length) found++
        } catch (e) {
          void logError(e instanceof Error ? e.message : String(e), { action: 'book_auto_cover', book_id: b.id })
          break
        }
      }
      running = false
      if (found) void qc.invalidateQueries({ queryKey: qk.books.library() })
    })()
  }, [books, qc])
}
