import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton, ToneDot, Truncate, type Tone } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { useConvertOldItems, useConvertPreview } from '../../items/useItems'
import type { ConvertPreview } from '../../items/itemTypes'

// Two parts of Settings → Subscriptions → Google for the one-item change
// (owner, 15.10.2026; migration 155):
// - "Convert old items": slots made before the change have no task, so Daily
//   can't tick them. Nothing converts by itself — the button shows what would
//   change first (counts and a few examples), and only "Convert" applies it;
//   the hook reports the result with its own Undo. Nothing is deleted.
// (Its second part — when Google Calendar changes were last read back — went
// with Google Calendar, 25.11.2026.)

export function ConvertOldItemsButton() {
  const [open, setOpen] = useState(false)
  const preview = useConvertPreview()
  const convert = useConvertOldItems()

  function show() {
    setOpen(true)
    // Always a fresh count: the preview is what "Convert" will do.
    void preview.refetch()
  }

  async function apply() {
    try {
      await convert.mutateAsync()
      setOpen(false)
    } catch { /* the hook says what failed; the sheet stays open */ }
  }

  const p = preview.data
  const count = p?.futureStandaloneBlocks ?? 0
  return (
    <>
      <Button size="sm" icon={<ArrowRightLeft />} onClick={show} tip="Convert — make slots from before the change into items Daily can tick; shows what changes first">
        Convert
      </Button>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        dismissible={!convert.isPending}
        title="Convert old items"
        subtitle="Nothing changes until you tap Convert"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setOpen(false)} disabled={convert.isPending}>Cancel</Button>
            <Button variant="primary" onClick={() => void apply()} loading={convert.isPending} disabled={!p || count === 0 || preview.isFetching}>
              {count > 0 ? `Convert ${count} ${count === 1 ? 'slot' : 'slots'}` : 'Convert'}
            </Button>
          </div>
        }
      >
        <ConvertPreviewBody preview={p} loading={preview.isFetching && !p} error={preview.error} onRetry={() => void preview.refetch()} />
      </ModalShell>
    </>
  )
}

function ConvertPreviewBody({ preview, loading, error, onRetry }: {
  preview: ConvertPreview | undefined; loading: boolean; error: Error | null; onRetry: () => void
}) {
  if (loading) {
    return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-5" rounded="rounded-md" />)}</div>
  }
  if (!preview) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
        {error ? `Couldn't count the old items: ${error.message}` : "Couldn't count the old items."}
        <Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button>
      </p>
    )
  }
  const facts: { tone: Tone; text: string }[] = [
    { tone: preview.futureStandaloneBlocks ? 'accent' : 'neutral', text: preview.futureStandaloneBlocks
      ? `${preview.futureStandaloneBlocks} future ${preview.futureStandaloneBlocks === 1 ? 'slot becomes an item' : 'slots become items'} you can tick off on Daily`
      : 'No future slot without a task — nothing to convert' },
    { tone: 'neutral', text: `${preview.pastStandaloneBlocks} past ${preview.pastStandaloneBlocks === 1 ? 'slot stays' : 'slots stay'} as ${preview.pastStandaloneBlocks === 1 ? 'it is' : 'they are'} (never marked done or missed after the fact)` },
    ...(preview.autoClearedEpisodes
      ? [{ tone: 'neutral' as Tone, text: `${preview.autoClearedEpisodes} planned ${preview.autoClearedEpisodes === 1 ? 'episode stays a slot' : 'episodes stay slots'} (watching one removes it)` }]
      : []),
    { tone: 'success', text: `${preview.tasksWithSlots} ${preview.tasksWithSlots === 1 ? 'task with a slot is' : 'tasks with a slot are'} already one item` },
    { tone: 'success', text: `${preview.plans} repeating ${preview.plans === 1 ? 'plan' : 'plans'}: ${preview.plans === 1 ? 'its days tick' : 'their days tick'} from Daily already` },
  ]
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {facts.map(f => (
          <li key={f.text} className="flex items-start gap-2 text-body text-fg-2">
            <ToneDot tone={f.tone} className="mt-1.5 shrink-0" />
            <span className="min-w-0">{f.text}</span>
          </li>
        ))}
      </ul>
      {preview.examples.length > 0 && (
        <div>
          <p className="section-label mb-1">For example</p>
          <ul className="flex flex-col divide-y divide-line rounded-row border border-line">
            {preview.examples.map(e => (
              <li key={`${e.date}-${e.title}`} className="flex items-center gap-3 px-3 py-2 text-body">
                <span className="shrink-0 text-meta tabular-nums text-fg-muted">{formatDate(e.date)}</span>
                <Truncate className="text-fg">{e.title}</Truncate>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-meta text-fg-muted">Nothing is deleted, and each slot keeps its calendar event. The result offers Undo.</p>
    </div>
  )
}
