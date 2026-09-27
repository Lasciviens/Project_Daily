import { Stethoscope } from 'lucide-react'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { Button, Card, CardHeader, Skeleton, TonePill, cx } from '../../../shared/ui'
import { HEALTH_DISCLAIMER } from '../benchmarks/healthGuidance'
import { BASELINE_DAYS } from '../vitalsReading'
import { useVitalsReading } from '../hooks/useVitalsReading'
import { SourceList } from './overview/MetricExplainer'
import type { HealthRange } from './sectionTypes'
import { useRangeWindow, windowNoun } from './dateNav'
import { VitalsReadingRows } from './VitalsReadingRows'

// "What your numbers say" — the top of the Heart & vitals window. The charts
// below show the data; this says what it means: one overall sentence, a small
// table (value · your usual · status · change) and a plain line per signal.
// All of it comes from vitalsReading.ts (pure, verified) over the same
// downloads the charts use. A count of what's off, never a score.

function LoadingCard() {
  return (
    <Card className="flex flex-col gap-3" aria-busy>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-16 w-full" rounded="rounded-row" />
      {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" rounded="rounded-row" />)}
    </Card>
  )
}

export function VitalsReadingCard({ range }: { range: HealthRange }) {
  const win = useRangeWindow(range)
  const { reading, isLoading, isPlaceholderData, isError, refetch } = useVitalsReading(win)
  if (isLoading && !reading.rows.length) return <LoadingCard />
  const { verdict, rows } = reading

  return (
    <Card className={cx('@container flex flex-col gap-3 transition-opacity', isPlaceholderData && 'opacity-60')} aria-busy={isPlaceholderData || undefined}>
      <CardHeader
        wrap
        className="mb-0"
        icon={<Stethoscope />}
        title="What your numbers say"
        subtitle={`${windowNoun(range.period, range.anchor)} · each signal against your own usual range`}
        action={(
          <InfoBubble label="How this reading works">
            <span className="block">
              Each signal is compared with your own usual range, built from the {BASELINE_DAYS} days before the day or period
              you’re looking at — so a bad week can’t hide inside its own average.
            </span>
            <span className="mt-1.5 block">
              It counts what’s off instead of scoring you, like Apple’s Vitals app, which only speaks up when two or more
              overnight signals move together. One odd day is usually noise; several days, or several signals at once, matter more.
            </span>
            <span className="mt-1.5 block text-fg-muted">Not a diagnosis — if you feel unwell or a number worries you, talk to a doctor.</span>
          </InfoBubble>
        )}
      />

      <div className="flex flex-col gap-1.5 rounded-row bg-surface-2 p-3" role="status">
        <TonePill tone={verdict.tone} className="self-start">{verdict.label}</TonePill>
        <p className="text-body font-semibold text-fg">{verdict.headline}</p>
        {verdict.notes.map(n => <p key={n} className="text-meta text-fg-2">{n}</p>)}
      </div>

      {isError && (
        <div className="flex flex-wrap items-center gap-2 text-meta text-fg-muted">
          Some readings didn’t load, so this may be incomplete.
          <Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>
        </div>
      )}

      {rows.length > 0 && <VitalsReadingRows rows={rows} to={reading.to} />}

      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <SourceList sources={reading.sources} />
        <p className="text-micro font-normal text-fg-faint">{HEALTH_DISCLAIMER}</p>
      </div>
    </Card>
  )
}
