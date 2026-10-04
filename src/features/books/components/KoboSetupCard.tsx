import { Copy, Settings2 } from 'lucide-react'
import { Button, Card, CardHeader } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { opdsAddress } from '../api/booksApi'
import type { KoboSyncState } from '../types'

/** How a book reaches the Kobo, and when the Kobo last checked. */
export function KoboSetupCard({ state }: { state: KoboSyncState | null | undefined }) {
  const address = opdsAddress()
  async function copy() {
    try { await navigator.clipboard.writeText(address); toast.success('Address copied — replace the token part') }
    catch { toast.error('Could not copy — select the address instead') }
  }
  const lastContact = [state?.last_seen_at, state?.last_feed_at].filter(Boolean).sort().pop() ?? null
  return (
    <Card>
      <CardHeader title="How books reach the Kobo" variant="label" icon={<Settings2 />}
        subtitle={lastContact ? `Kobo last checked ${formatDateTime(lastContact)}` : 'The Kobo has not checked the inbox yet'} />
      <p className="text-body text-fg-2">
        With the <strong>Lasci's Board</strong> plugin in KOReader, a book you send downloads by itself the next time the Kobo’s Wi-Fi comes on
        (into the <em>Send to Kobo</em> folder). Nothing to tap.
      </p>
      <details className="mt-3 text-body text-fg-2">
        <summary className="min-h-[44px] cursor-pointer py-2 font-medium text-fg">Without the plugin: the OPDS catalogue</summary>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>In KOReader: 🔍 → <strong>OPDS catalog</strong> → ☰ → <strong>Add catalog</strong>.</li>
          <li>Name: <em>Lasci's Board</em>. URL: the address below, with your token in place of the placeholder (<code>KOBO_OPDS_TOKEN</code>).</li>
          <li>Tick <strong>Sync catalog</strong>, then ☰ → <strong>Sync all catalogs</strong> after sending a book.</li>
        </ol>
        <div className="mt-3 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-control bg-surface-2 px-2.5 py-2 text-micro text-fg-2">{address}</code>
          <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => { void copy() }}>Copy</Button>
        </div>
      </details>
      <p className="mt-2 text-micro text-fg-muted">Files never stay: a book is deleted 24 hours after the Kobo downloads it, or after 7 days if it never does.</p>
    </Card>
  )
}
