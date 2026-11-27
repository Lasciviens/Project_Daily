import { formatDate } from '../../../../shared/utils/dateFormat'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { Clock, Flag } from 'lucide-react'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { labelForSlug, movementPatternLabel } from '../../muscleMap'
import { VOLUME_BANDS, VOLUME_TARGET } from '../../plan/volumeBands'
import { useBandColors } from '../muscleBandColors'
import { MuscleExerciseList } from './MuscleExerciseList'
import { FLAG_META, TREND_TONE, bandGuidance, daysAgoText, trendIcon, type MuscleRead } from './muscleVolumeModel'

/** One selected muscle: status, plain guidance, cues, exercises and days. */
export function MuscleDetailCard({ read, windowDays, priorHasData }: {
  read: MuscleRead
  windowDays: number
  priorHasData: boolean
}) {
  const bandColors = useBandColors()
  const { slug, weekly, band, gap, restriction, dates, sessions, freqPerWeek, daysSince, trend } = read
  const meta = restriction ? FLAG_META[restriction.weight] : { label: VOLUME_BANDS[band].label, desc: VOLUME_BANDS[band].note }
  const metaColor = restriction ? bandColors.flag[restriction.weight] : bandColors.bands[band]

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${metaColor}` }}>
        <div className="min-w-0">
          <p className="text-title font-semibold leading-tight text-fg">{labelForSlug(slug)}</p>
          <span className="flex items-center gap-1.5 text-meta font-semibold text-fg-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: metaColor }} />{meta.label}
          </span>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-kpi font-bold leading-none tabular-nums text-fg">{Math.round(weekly)}</p>
          <p className="mt-0.5 text-micro font-normal text-fg-muted">sets / week</p>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* The flag is its own state, named to the source limitation. Volume
            guidance below still proceeds: a flag narrows exercise CHOICE, it
            doesn't erase the muscle's real training-volume read. */}
        {restriction && (
          <div className="flex flex-col gap-1.5 rounded-row border border-line bg-surface-2 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-meta font-semibold text-fg">
              <Flag className="h-3.5 w-3.5" style={{ color: metaColor }} aria-hidden /> {meta.label}
              <InfoBubble>{meta.desc} Flagging a muscle never means it can't be trained — it means favouring exercises that don't rely on the flagged movement pattern.</InfoBubble>
            </p>
            <ul className="flex flex-col gap-1">
              {restriction.items.map((hit, i) => (
                <li key={i} className="flex items-start gap-1.5 text-meta text-fg-2">
                  <span className="shrink-0 font-semibold text-fg">({hit.weight})</span>
                  <span>{movementPatternLabel(hit.limitation.movement_pattern)}{hit.limitation.note ? ` — "${hit.limitation.note}"` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="flex items-start gap-1 text-body text-fg-2">
          <span>
            {bandGuidance(band)}
            {gap && (restriction
              ? ' An active limitation reaches this muscle, so a low number may be deliberate.'
              : ` That's about ${gap.sets} more sets a week — roughly ${gap.sessions === 1 ? 'one more session' : `${gap.sessions} more sessions`}.`)}
          </span>
          <InfoBubble>
            Weekly hard sets, in words: {VOLUME_BANDS.slice(1).map(b => `${b.range} ${b.label.toLowerCase()}`).join(' · ')}. None of
            these is an error — more sets add less and less. Ranges from a large meta-regression of training studies; guidance for
            most people, not personalised. Assumes your sets were reasonably hard.
          </InfoBubble>
        </p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
          <span className="flex items-center gap-1 text-fg-2">
            trained <strong className="tabular-nums text-fg">{sessions}×</strong> in {windowDays}d
            <InfoBubble><p>Days you <strong>directly</strong> trained this muscle (~{freqPerWeek.toFixed(1)}/week). Days it only assisted another lift aren't counted here. Same weekly sets usually feel better split over 2 days — frequency distributes volume, it isn't a growth multiplier by itself.</p></InfoBubble>
          </span>
          {priorHasData ? (trend && (
            <span data-tone={TREND_TONE[trend]} className="tone-text flex items-center gap-1">
              {trendIcon(trend)} {trend === 'up' ? 'more than usual' : trend === 'down' ? 'less than usual' : 'steady'}
              <InfoBubble><p>This window's volume vs the previous {windowDays} days. Descriptive only — more/less lately, not "growing faster". A drop may just be a lighter week.</p></InfoBubble>
            </span>
          )) : (
            <span className="text-fg-muted">new — no baseline yet</span>
          )}
          {daysSince != null && (
            <span data-tone={daysSince > 7 ? 'warn' : undefined} className={`flex items-center gap-1 ${daysSince > 7 ? 'tone-text' : 'text-fg-muted'}`}>
              {daysSince > 7 && <Clock className="h-3 w-3" aria-hidden />}
              last trained {daysSince === 0 ? 'today' : `${daysSince}d ago`}
            </span>
          )}
        </div>

        <p className="rounded-row bg-surface-2 px-2.5 py-1.5 text-meta font-semibold text-fg">
          Bottom line: {gap
            ? restriction
              ? `work within your limitation — pick ${labelForSlug(slug)} exercises that respect it before adding sets.`
              : `add ~${gap.sets} sets of ${labelForSlug(slug)} work (≈ ${gap.sessions === 1 ? 'one more session' : `${gap.sessions} sessions`}).`
            : weekly < VOLUME_TARGET.min - 0.5
              ? `this still builds muscle; more sets toward ${VOLUME_TARGET.min} add a little more.`
              : `keep it here — progress load (reps then weight), not more sets.`}
        </p>

        <MuscleExerciseList exercises={read.exercises} />

        <div>
          <p className="section-label mb-1">
            Trained {dates.length} day{dates.length !== 1 ? 's' : ''}
            {dates[0] && <span className="normal-case"> · last {daysAgoText(dates[0], todayStr())}</span>}
          </p>
          {dates.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {dates.slice(0, 12).map((d, i) => (
                <span key={i} className="chip tabular-nums">{formatDate(d)}</span>
              ))}
              {dates.length > 12 && <span className="px-1 py-0.5 text-meta text-fg-muted">+{dates.length - 12}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
