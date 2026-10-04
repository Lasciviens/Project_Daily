import { Copy, Settings2 } from 'lucide-react'
import { Button, Card, CardHeader } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { opdsAddress } from '../api/booksApi'
import type { KoboFeedState } from '../types'

/** The one-time KOReader setup, and when the Kobo last checked the catalogue. */
export function KoboSetupCard({ state }: { state: KoboFeedState | null | undefined }) {
  const address = opdsAddress()
  async function copy() {
    try { await navigator.clipboard.writeText(address); toast.success('Address copied — replace the token part') }
    catch { toast.error('Could not copy — select the address instead') }
  }
  return (
    <Card>
      <CardHeader title="Set up the Kobo once" variant="label" icon={<Settings2 />}
        subtitle={state?.last_feed_at ? `Kobo last checked ${formatDateTime(state.last_feed_at)}` : 'The Kobo has not checked the inbox yet'} />
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-body text-fg-2">
        <li>In KOReader: 🔍 → <strong>OPDS catalog</strong> → <strong>+</strong> (add catalog).</li>
        <li>Name: <em>Lasci's Board</em>. URL: the address below, with your token in place of the placeholder (the same value as <code>KOBO_OPDS_TOKEN</code>).</li>
        <li>Tick <strong>Sync catalog</strong> and pick a download folder.</li>
        <li>After sending a book: <strong>Sync all catalogs</strong>.</li>
      </ol>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-control bg-surface-2 px-2.5 py-2 text-micro text-fg-2">{address}</code>
        <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => { void copy() }}>Copy</Button>
      </div>
      <p className="mt-2 text-micro text-fg-muted">Files never stay: a book is deleted 24 hours after the Kobo downloads it, or after 7 days if it never does.</p>
    </Card>
  )
}
