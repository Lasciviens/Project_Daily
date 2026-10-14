import { Card, TonePill } from '../../../../shared/ui'
import { clockRows, fmtClock } from '../../healthTrendStats'
import type { HealthHero } from './useHealthHero'
import { SleepTimeline } from './SleepTimeline'

// Sleep regularity: bed and wake time over the period picked in the range bar
// and the spread of the wake time (Windred 2024: regularity predicted
// mortality more strongly than duration).
export function SleepTimingCard({ sleep, from, to }: { sleep: HealthHero['sleep']; from: string; to: string }) {
  if (!sleep.timeline.length) return null
  // A single day has one night: its own times, no spread.
  const night = from === to ? sleep.timeline[sleep.timeline.length - 1] : null
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-fg">Bed and wake time</p>
        {sleep.regularityCls && <TonePill tone={sleep.regularityCls.tone}>{sleep.regularityCls.label}</TonePill>}
      </div>
      <p className="text-meta text-fg-2">
        {night
          ? <>Asleep {fmtClock(night.onset)} · woke {fmtClock(night.wake)}</>
          : sleep.wake
          ? <>Wake {fmtClock(sleep.wake.center)} ± {Math.round(sleep.wake.sd)} min
            {sleep.onset && <> · asleep {fmtClock(sleep.onset.center)} ± {Math.round(sleep.onset.sd)} min</>}</>
          : 'At least 5 nights with a recorded session are needed for a spread.'}
      </p>
      <SleepTimeline rows={clockRows(sleep.timeline, from, to)} wakeCenter={sleep.wake?.center} onsetCenter={sleep.onset?.center} />
    </Card>
  )
}
