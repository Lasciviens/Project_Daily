import { useMemo, useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import { Card, CardHeader, Skeleton, TonePill, Truncate } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { useTrainingHistory } from '../../hooks/useTrainingProgress'
import { useAthleteLimitations } from '../../hooks/useAthleteProfile'
import { useTodayStr } from '../../hooks/useTrainingSessions'
import { restrictionsBySlug } from '../../muscleMap'
import { limitationNote, weeklyMuscleSets, type MuscleSets } from '../../plan/results'
import { VOLUME_BANDS, wholeSets } from '../../plan/volumeBands'
import { WorkedMuscles } from '../WorkedMuscles'

function Row({ m }: { m: MuscleSets }) {
  const note = limitationNote(m)
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_3.25rem_3.25rem] items-center gap-x-2 border-b border-line py-1.5 last:border-0">
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Truncate className="min-w-0 text-body font-medium text-fg">{m.label}</Truncate>
          <TonePill tone={m.band.tone} className="shrink-0">{m.band.label}</TonePill>
        </span>
        {note && <span className="text-meta text-fg-muted">{note}</span>}
      </span>
      <span className="text-right text-body tabular-nums text-fg-2">{wholeSets(m.lastWeek)}</span>
      <span className="text-right text-body font-semibold tabular-nums text-fg">{wholeSets(m.average)}</span>
    </li>
  )
}

/** Results' second card: hard sets per muscle — the last 7 days and the 4-week average — in S18's words (never red).
 *  The body map (the same counting, by period) opens behind a tap. */
export function WeeklySetsCard() {
  const today = useTodayStr()
  const { data: history, isLoading } = useTrainingHistory()
  const { data: limitations = [] } = useAthleteLimitations(true)
  const [showMap, setShowMap] = useState(false)
  const rows = useMemo(() => {
    if (!history) return []
    return weeklyMuscleSets(history.sets, history.templates, today, restrictionsBySlug(limitations))
  }, [history, today, limitations])

  if (isLoading) return <Skeleton rounded="rounded-card" className="h-72" />
  return (
    <Card className="flex flex-col">
      <CardHeader
        icon={<Layers />}
        title={<span className="inline-flex items-center gap-1.5">Weekly sets per muscle
          {/* Says what plan/results.weeklyMuscleSets and plan/volumeBands do: change them together. */}
          <InfoBubble label="How the sets are counted">
            <b>Hard sets</b>: every working set counts <b>1</b> for the muscle the exercise trains most and <b>0.5</b> for each
            helper muscle; warm-ups count 0. <b>7 days</b> is the last 7 days up to today; <b>4-wk</b> is the last 28 days ÷ 4,
            rounded to whole sets. The words read the 4-week average, so one short week doesn&apos;t change them.
            <span className="mt-1.5 block">
              {VOLUME_BANDS.slice(1).map((b, i) => <span key={b.id}>{i > 0 && ' · '}<b>{b.range}</b> {b.label.toLowerCase()}</span>)}.
              {' '}None of these is an error: more sets add less and less, they never hurt by themselves.
            </span>
          </InfoBubble>
        </span>}
        subtitle="Hard sets a week, from your logged workouts"
      />
      <div className="grid grid-cols-[minmax(0,1fr)_3.25rem_3.25rem] gap-x-2 border-b border-line-strong pb-1 text-right section-label">
        <span className="text-left">Muscle</span>
        <span title="Hard sets in the last 7 days">7 days</span>
        <span title="Average a week over the last 4 weeks">4-wk</span>
      </div>
      {rows.length === 0
        ? <p className="py-3 text-body text-fg-muted">No workouts in the last 4 weeks.</p>
        : <ul className="flex flex-col">{rows.map(m => <Row key={m.slug} m={m} />)}</ul>}
      <div className="mt-2 border-t border-line pt-2">
        <button type="button" aria-expanded={showMap} onClick={() => setShowMap(v => !v)} className="btn-ghost btn-sm gap-1.5 text-meta"
          title="Body map: each muscle by colour, any period, with what it took">
          <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${showMap ? 'rotate-180' : ''}`} />
          Body map
        </button>
        {showMap && <div className="mt-2"><WorkedMuscles /></div>}
      </div>
    </Card>
  )
}
