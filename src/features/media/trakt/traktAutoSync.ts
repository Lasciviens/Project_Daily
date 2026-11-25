import type { QueryClient } from '@tanstack/react-query'
import { invalidate, qk } from '../../../shared/query'
import { syncTrakt } from './traktApi'
import type { TraktStatus } from './traktTypes'
import { SYNC_DELAY_MS, syncRetryAfter } from './traktAutoSyncRules'

// After a change here (watched, rating, status…), send it to Trakt a few
// seconds later instead of waiting for the 30-minute cron. Changes made in
// quick succession share one sync. Background work: a failure is not toasted
// — it lands on the Trakt card (last error, changes waiting) and the cron
// retries it.

let timer: ReturnType<typeof setTimeout> | null = null

export function scheduleTraktSync(qc: QueryClient, delay = SYNC_DELAY_MS, attempt = 0) {
  const status = qc.getQueryData<TraktStatus>(qk.trakt.status())
  if (status && !status.connected) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    let again: number | null = null
    try {
      const r = await syncTrakt()
      // Notes taken from Trakt can arrive in a run that read nothing else.
      if (r.pulled || r.notes?.fromTrakt) await invalidate(qc, 'media')
      again = syncRetryAfter(r, attempt)
    } catch { /* shown on the Trakt card */ }
    await qc.invalidateQueries({ queryKey: qk.trakt.all })
    // Another sync was running: once more a little later (a newer change has its own timer already).
    if (again !== null && !timer) scheduleTraktSync(qc, again, attempt + 1)
  }, delay)
}
