import { useQuery } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { toast } from '../../../../app/store'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../../shared/query'
import { Button, Truncate } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { fetchPictureSources, setPictureSourceState, type PictureSource } from '../../api/shopPictureApi'

/** What the last failed read of a host says, in the shared words ("apps", never "robots"). */
const WHY: Record<string, string> = {
  not_allowed: "doesn't let apps read its pages",
  blocked: 'blocks apps with a browser check',
  no_picture: 'had no picture',
  error: "couldn't be read",
}

const line = (s: PictureSource) => {
  const bits: string[] = []
  if (s.ok_count > 0) bits.push(`${s.ok_count} ${s.ok_count === 1 ? 'picture' : 'pictures'}`)
  if (s.fail_count > 0) bits.push(`${s.fail_count} failed${s.last_reason ? ` · ${WHY[s.last_reason] ?? s.last_reason}` : ''}`)
  const day = s.last_ok_at ?? s.last_fail_at
  if (day) bits.push(`last ${formatDate(day)}`)
  return bits.join(' · ')
}

/**
 * Picture sources (read-only list, under Stores and rules): which sites gave a product's picture when a receipt line's page was
 * read, and which did not. Only the picture read of `shop-price` writes these counts; the list ranks the pages read next time (hosts
 * that gave pictures first, hosts that refused apps left out). Clear a host and it counts as unknown again — with Undo.
 */
export function PictureSources() {
  const sources = useQuery({ queryKey: qk.shop.pictureSources(), queryFn: fetchPictureSources, staleTime: STALE.short })
  const set = useMutationWithFeedback({
    action: 'picture_source_state',
    silent: 'its toast with Undo says what was cleared; Undo puts it back',
    mutationFn: ({ id, state }: { id: string; state: PictureSource['state'] }) => setPictureSourceState(id, state),
    invalidates: [qk.shop.pictureSources()],
  })
  const rows = (sources.data ?? []).filter(s => s.state === 'on')
  if (sources.isLoading || sources.isError || rows.length === 0) return null

  const clear = (s: PictureSource) => set.mutate({ id: s.id, state: 'ignored' }, {
    onSuccess: () => toast.undo(`${s.host} cleared`, () => set.mutate({ id: s.id, state: 'on' })),
  })
  return (
    <section aria-label="Picture sources" className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 className="text-body font-semibold text-fg">Picture sources</h3>
      <p className="text-meta text-fg-muted">Sites a product page was read from for its picture. Ones that worked are read first next time; ones that don't let apps read them are skipped.</p>
      <ul className="flex flex-col gap-1">
        {rows.map(s => {
          const worked = s.ok_count > 0 && s.ok_count >= s.fail_count
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-row border border-line bg-surface px-3 py-1.5">
              {worked ? <Check aria-hidden className="h-4 w-4 shrink-0 text-success" /> : <X aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />}
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-fg"><Truncate>{s.host}</Truncate></p>
                <p className="text-meta text-fg-muted"><Truncate>{line(s)}</Truncate></p>
              </div>
              <Button size="sm" onClick={() => clear(s)} disabled={set.isPending} aria-label={`Clear ${s.host}`}>Clear</Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
