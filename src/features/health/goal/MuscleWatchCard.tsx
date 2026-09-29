import { Link } from 'react-router-dom'
import { ChevronRight, ShieldAlert } from 'lucide-react'
import { SkeletonText, ToneDot, TonePill } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import type { EvidenceTier, MuscleWatch } from './muscleWatch'
import { MUSCLE_WATCH_LEVEL as LEVEL_COPY } from './goalCopy'
import { MUSCLE_WATCH_HREF, useMuscleWatch } from './useMuscleWatch'
import { GoalBlock, Cites } from './GoalBlock'

const TIER_LABEL: Record<EvidenceTier, string> = { measured: 'Measured', evidence: 'Evidence', heuristic: 'Heuristic' }
const CONFIDENCE_LABEL = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const

/** Health → Goal progress: "am I losing muscle?" in plain words (muscleWatch.ts). */
export function MuscleWatchCard({ card = true }: { card?: boolean }) {
  const { watch, isLoading } = useMuscleWatch()
  return (
    <GoalBlock title="Muscle watch" card={card}
      action={watch && <TonePill tone={LEVEL_COPY[watch.level].tone}>{LEVEL_COPY[watch.level].label}</TonePill>}
      info={<>
        Several signals read together, because none is reliable alone. <b>Strength</b>: your current program&apos;s main lifts
        (est. 1RM, last 4 weeks) — down more than 5 % on two or more is the clearest sign. <b>Scale</b>: lean and muscle mass since
        the phase started; home scales swing about ±1 kg, so only a drop over 1 kg across 4+ weeks counts, and early in a cut much of
        it is water and glycogen. <b>Pace</b>: losing more than 1 % of bodyweight a week. <b>Protein</b>: under 1.6 g/kg; aim for
        ~2.2 g/kg. Any one of these is worth watching; &quot;likely losing muscle&quot; needs falling strength plus one more. A scale drop
        alone never counts as muscle loss. An estimate, not a body scan.
        <Cites keys={['looney2024', 'garthe2011', 'helms2014prep', 'morton2018']} />
      </>}>
      {isLoading && !watch && <SkeletonText lines={3} />}
      {!isLoading && !watch && <p className="text-body text-fg-muted">Couldn&apos;t read the scale, diary or training data.</p>}
      {watch && <MuscleWatchBody watch={watch} />}
    </GoalBlock>
  )
}

function MuscleWatchBody({ watch }: { watch: MuscleWatch }) {
  return (
    <>
      <p className="text-body font-semibold text-fg">{watch.headline}</p>
      {watch.reasons.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {watch.reasons.map(r => (
            <li key={r.signal} className="flex items-start gap-2 text-meta text-fg-2">
              <ToneDot tone={r.tone} className="mt-1.5 shrink-0" />
              <span className="min-w-0 flex-1">{r.text}</span>
              <TonePill tone="neutral" className="shrink-0">{TIER_LABEL[r.evidenceTier]}</TonePill>
            </li>
          ))}
        </ul>
      )}
      {watch.actions.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="section-label">What to do</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-meta text-fg">
            {watch.actions.map(a => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      <p className="text-micro font-normal text-fg-muted">{CONFIDENCE_LABEL[watch.confidence]} · since {formatDate(watch.from)}</p>
    </>
  )
}

/** One line outside Goal progress (Training → Next / Progress) — only when there is something to watch. */
export function MuscleWatchLine() {
  const { watch } = useMuscleWatch()
  if (!watch || (watch.level !== 'watch' && watch.level !== 'likely_loss')) return null
  const tone = LEVEL_COPY[watch.level].tone
  return (
    <Link to={MUSCLE_WATCH_HREF}
      className="flex min-h-[44px] w-full max-w-2xl items-start gap-2 rounded-row border border-line bg-surface px-3 py-2 text-body text-fg-2 hover:bg-surface-2">
      <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
      <ToneDot tone={tone} className="mt-1.5 shrink-0" />
      <span className="min-w-0 flex-1">{watch.headline}</span>
      <ChevronRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
    </Link>
  )
}
