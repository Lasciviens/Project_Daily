import { BookOpen, Inbox, X } from 'lucide-react'
import { Card, CardHeader, EmptyState, IconButton, SkeletonText, TonePill, Truncate } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { displayTitle } from '../opdsFeed'
import { useCancelDelivery, useDeleteDeliveryRow } from '../hooks/useBooks'
import type { BookDelivery } from '../types'
import { DELIVERY_LABEL, DELIVERY_TONE, megabytes } from './bookFormat'

/** Everything sent, newest first, with where each file is now. */
export function DeliveryList({ rows, loading }: { rows: BookDelivery[]; loading: boolean }) {
  const cancel = useCancelDelivery()
  const remove = useDeleteDeliveryRow()
  return (
    <Card padded={false}>
      <div className="px-4 pt-4"><CardHeader title="Inbox" variant="label" icon={<Inbox />} subtitle="Kept until the Kobo has it, then 24 hours" /></div>
      {loading ? <div className="p-4"><SkeletonText lines={3} /></div> : rows.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="Nothing sent yet" description="Books you send appear here until the Kobo has them." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(d => {
            const done = d.status === 'expired' || d.status === 'cancelled'
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Truncate className="text-body font-medium text-fg">{displayTitle(d)}</Truncate>
                  <p className="flex flex-wrap items-center gap-x-2 text-micro tabular-nums text-fg-muted">
                    <TonePill tone={DELIVERY_TONE[d.status]}>{DELIVERY_LABEL[d.status]}</TonePill>
                    <span>{megabytes(d.size_bytes)}</span>
                    <span>sent {formatDateTime(d.created_at)}</span>
                    {d.downloaded_at && <span>downloaded {formatDateTime(d.downloaded_at)}</span>}
                  </p>
                </div>
                {d.status === 'queued' && (
                  <IconButton label={`Cancel ${displayTitle(d)}`} onClick={() => cancel.mutate(d)}><X /></IconButton>
                )}
                {done && (
                  <IconButton label={`Remove ${displayTitle(d)} from the list`} onClick={() => remove.mutate(d.id)} className="text-fg-faint"><X /></IconButton>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
