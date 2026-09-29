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
        Five signals read together, because no one of them is reliable alone: the smart scale&apos;s muscle and lean mass since the
        phase started (it swings ±0.5 kg day to day), how much of the weight lost was lean, how fast you are losing, logged protein,
        and whether your current-program lifts (est. 1RM) and training are holding. A falling scale with falling strength is the clearest
        sign of real muscle loss; holding strength says the drop is more likely water. An estimate, not a body scan.
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
