import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, MetaLine, Skeleton } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatDate } from '../../../../shared/utils/dateFormat'
import type { Phase } from '../../goal/bodyGoal'
import { VERDICT_TONE, type WeekCell, type WeeklyMetric, type WeeklyMetricMeta } from '../../weeklyBodyChanges'
import { num, signed } from '../overview/heroFormat'
import type { HealthRange } from '../sectionTypes'
import { SectionCard } from '../sectionKit'
import { useWeeklyBodyChanges } from './useWeeklyBodyChanges'

// Health → Body, beside the scale charts: one row per Monday–Sunday week,
// newest first — each column's week average and, under it, the change from the
// week before, coloured by the phase (weeklyBodyChanges.ts). The page's period
// sets how many weeks; a year folds after the first 14 (a 90-day window's worth).

const FOLD_AT = 14
const PHASE_WORD: Record<Phase, string> = { cut: 'Cut', maintain: 'Maintain', gain: 'Gain' }
const HEAD: Record<WeeklyMetric, string> = { weight: 'Weight kg', fat: 'Fat %', muscle: 'Muscle %', score: 'Score' }
// The table grows with its columns, never past one content row (THEME §6.6 W2).
const TABLE_WIDTH = ['max-w-xs', 'max-w-xs', 'max-w-sm', 'max-w-md', 'max-w-lg']
const VERDICT_WORDS = { good: 'good for your phase', bad: 'against your phase', plain: '', steady: '' } as const

function Change({ cell, meta }: { cell: WeekCell; meta: WeeklyMetricMeta }) {
  if (cell.change == null || cell.verdict == null) return null
  if (cell.verdict === 'steady') return <span className="block text-meta text-fg-muted">steady</span>
  return (
    <span data-tone={VERDICT_TONE[cell.verdict]} className="tone-text block text-meta font-semibold">
      {signed(cell.change, meta.decimals)}
      {VERDICT_WORDS[cell.verdict] && <span className="sr-only"> ({VERDICT_WORDS[cell.verdict]})</span>}
    </span>
  )
}

export function WeeklyChangesCard({ range }: { range: HealthRange }) {
  const { rows, firstReading, metrics, phase, isLoading, dimmed } = useWeeklyBodyChanges(range)
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FOLD_AT)
  const anyReading = rows.some(r => metrics.some(m => r.cells[m.key].avg != null))
  const fromReport = metrics.some(m => m.key === 'muscle' || m.key === 'score')

  return (
    <SectionCard dimmed={dimmed}>
      <div>
        <p className="flex items-center gap-1 text-body font-semibold text-fg">
          Weekly changes
          <InfoBubble label="About weekly changes">
            Each row is a Monday–Sunday week: the average of the days with a reading and, under it, the change from the week
            before. Green is good for your phase — weight moving the phase&apos;s way at its pace, body fat down, muscle up;
            amber is the other way, or weight moving faster than the phase&apos;s pace. &ldquo;steady&rdquo; means smaller
            than the scale&apos;s own noise: ±0.3 kg, ±0.6 points body fat or muscle, 1 point body score. Body fat is from
            the scale in use only; muscle (% of body weight) and the body score only from the scale&apos;s photo report — the
            body score is the scale&apos;s own number and isn&apos;t judged. The newest week counts up to the day you&apos;re
            viewing; – means no reading that week.
          </InfoBubble>
        </p>
        <MetaLine className="text-meta text-fg-muted" items={['Week average', 'change vs the week before', phase && `${PHASE_WORD[phase]} phase`]} />
      </div>

      {isLoading ? (
        <Skeleton rounded="rounded-row" className="h-40" />
      ) : !anyReading ? (
        <p className="text-meta text-fg-muted">No scale readings in these weeks.</p>
      ) : (
        <table className={`w-full table-fixed border-collapse text-right tabular-nums ${TABLE_WIDTH[metrics.length]}`}>
          <caption className="sr-only">Weekly averages and the change from the week before, newest week first</caption>
          <thead>
            <tr className="text-micro font-medium text-fg-muted">
              <th scope="col" className="w-[5.25rem] pb-1 text-left font-medium">Week</th>
              {metrics.map(m => (
                <th key={m.key} scope="col" className="pb-1 pl-1 font-medium">{HEAD[m.key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.weekStart} className="border-t border-line align-top">
                <th scope="row" className="py-1.5 text-left text-meta font-medium text-fg-2">
                  {formatDate(r.weekStart)}
                  <span className="block font-normal text-fg-muted">– {formatDate(r.weekEnd)}</span>
                </th>
                {metrics.map(m => {
                  const cell = r.cells[m.key]
                  return (
                    <td key={m.key} className="py-1.5 pl-1">
                      {cell.avg == null
                        ? <span className="text-body text-fg-muted"><span aria-hidden>–</span><span className="sr-only">no reading</span></span>
                        : <span className="block text-body font-semibold text-fg" title={`${cell.days} ${cell.days === 1 ? 'day' : 'days'} with a reading`}>{num(cell.avg, m.decimals)}</span>}
                      <Change cell={cell} meta={m} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!isLoading && rows.length > FOLD_AT && (
        <Button size="sm" variant="ghost" aria-expanded={all} onClick={() => setAll(a => !a)} className="-ml-2 gap-1 self-start px-2 text-meta"
          icon={<ChevronDown className={`transition-transform ${all ? 'rotate-180' : ''}`} />}>
          {all ? 'Show fewer weeks' : `Show ${rows.length - FOLD_AT} earlier weeks`}
        </Button>
      )}
      {!isLoading && anyReading && firstReading && (
        <p className="text-meta text-fg-muted">No scale readings before {formatDate(firstReading)}.</p>
      )}
      {!isLoading && anyReading && !fromReport && (
        <p className="text-meta text-fg-muted">Muscle % and body score come from the scale&apos;s photo report — none in these weeks.</p>
      )}
    </SectionCard>
  )
}
