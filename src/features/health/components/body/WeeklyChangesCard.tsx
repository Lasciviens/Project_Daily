import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, MetaLine, Skeleton, ToneDot } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import type { Phase } from '../../goal/bodyGoal'
import { isoWeek, shortWeekSpan, weekRangeLabel } from '../../healthDateLabels'
import { VERDICT_TONE, type WeekCell, type WeekComment, type WeeklyMetric, type WeeklyMetricMeta } from '../../weeklyBodyChanges'
import { num, signed } from '../overview/heroFormat'
import type { HealthRange } from '../sectionTypes'
import { SectionCard } from '../sectionKit'
import { useWeeklyBodyChanges } from './useWeeklyBodyChanges'

// Health → Body, beside the scale charts: one row per Monday–Sunday week,
// newest first — its week number (underlined) with its days small on one line
// ("12.10 – 18.10", the owner's form; the year appears once above a group of
// weeks from another year), each column's week average and, under it, the
// change from the week before, coloured by the phase, then one thin comment
// line read from those same changes (weeklyBodyChanges.weekComment, rule-based).
// The page's period sets the weeks; a year folds after the first 14 (a
// 90-day window's worth).

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

/** The thin line under a week; the dot carries its tone (none when neutral). */
function CommentLine({ comment, span }: { comment: WeekComment; span: number }) {
  return (
    <tr>
      <td colSpan={span} className="pb-1.5 text-left text-micro font-normal leading-snug text-fg-muted">
        <span className="flex items-start gap-1.5">
          {comment.tone !== 'neutral' && <ToneDot tone={comment.tone} className="mt-[0.35em] shrink-0" />}
          <span className="min-w-0">{comment.text}</span>
        </span>
      </td>
    </tr>
  )
}

export function WeeklyChangesCard({ range }: { range: HealthRange }) {
  const { rows, comments, firstReading, metrics, phase, isLoading, dimmed } = useWeeklyBodyChanges(range)
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FOLD_AT)
  const today = todayStr()
  const thisYear = isoWeek(today).year
  const anyReading = rows.some(r => metrics.some(m => r.cells[m.key].avg != null))
  const fromReport = metrics.some(m => m.key === 'muscle' || m.key === 'score')

  return (
    <SectionCard dimmed={dimmed}>
      <div>
        <p className="flex items-center gap-1 text-body font-semibold text-fg">
          Weekly changes
          <InfoBubble label="About weekly changes">
            Each row is a Monday–Sunday week, by its week number: the average of the days with a reading and, under it, the
            change from the week before; the line under the row says what those changes mean. Green is good for your phase — weight moving the phase&apos;s way at its pace, body fat down, muscle up;
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
              <th scope="col" className="w-[5.5rem] pb-1 text-left font-medium">Week</th>
              {metrics.map(m => (
                <th key={m.key} scope="col" className="pb-1 pl-1 font-medium">{HEAD[m.key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const { week, year } = isoWeek(r.weekStart)
              const prevYear = i === 0 ? thisYear : isoWeek(shown[i - 1].weekStart).year
              return (
                <Fragment key={r.weekStart}>
                  {year !== prevYear && (
                    <tr>
                      <th scope="rowgroup" colSpan={metrics.length + 1} className="border-t border-line pt-1.5 text-left text-micro font-semibold text-fg-muted">{year}</th>
                    </tr>
                  )}
                  <tr className="border-t border-line align-top">
                    <th scope="row" className="pb-0.5 pt-1.5 text-left font-medium" title={weekRangeLabel(r.weekStart, today)}>
                      <span className="block text-meta text-fg-2 underline underline-offset-2">Week {week}</span>
                      <span className="block whitespace-nowrap text-micro font-normal tabular-nums text-fg-muted">{shortWeekSpan(r.weekStart)}</span>
                    </th>
                    {metrics.map(m => {
                      const cell = r.cells[m.key]
                      return (
                        <td key={m.key} className="pb-0.5 pl-1 pt-1.5">
                          {cell.avg == null
                            ? <span className="text-body text-fg-muted"><span aria-hidden>–</span><span className="sr-only">no reading</span></span>
                            : <span className="block text-body font-semibold text-fg" title={`${cell.days} ${cell.days === 1 ? 'day' : 'days'} with a reading`}>{num(cell.avg, m.decimals)}</span>}
                          <Change cell={cell} meta={m} />
                        </td>
                      )
                    })}
                  </tr>
                  <CommentLine comment={comments[i]} span={metrics.length + 1} />
                </Fragment>
              )
            })}
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
