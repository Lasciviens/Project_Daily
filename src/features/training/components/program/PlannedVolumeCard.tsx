import { useState } from 'react'
import { BarChart3, ChevronDown } from 'lucide-react'
import { Card, CardHeader, TonePill } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { MusclePreferencesList } from '../MusclePreferencesList'
import { MUSCLE_STATUS_TONE, RECOMMENDED_RANGE, TIER_LABEL, type MuscleRead } from '../../plan/programBalance'
import type { Tone } from '../../../../shared/ui'
import { SourceNote } from './SourceNote'

// Scale for the bars: 30 sets (Pelland's "lowest efficiency" tier starts
// there), or the biggest planned figure if higher.
const SCALE_FLOOR = 30

const BAR_FILL: Record<Tone, string> = {
  success: 'bg-success', warn: 'bg-warn', danger: 'bg-danger', info: 'bg-info', neutral: 'bg-neutral',
  highlight: 'bg-highlight', star: 'bg-star', accent: 'bg-accent-500',
}

function MuscleRow({ m, scale }: { m: MuscleRead; scale: number }) {
  const tone = MUSCLE_STATUS_TONE[m.status]
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-[7rem] text-body font-semibold text-fg">{m.label}</span>
        <span className="text-body font-semibold tabular-nums text-fg">{m.weeklySets}</span>
        <span className="text-meta text-fg-muted">sets/wk{m.directSets > 0 && m.directSets !== m.weeklySets ? ` (${m.directSets} direct)` : ''}</span>
        {m.priority && <TonePill tone="star">Priority</TonePill>}
        {m.restriction && <TonePill tone="highlight">{m.restriction === 'avoid' ? 'Avoid' : 'Limit'} limitation</TonePill>}
        <TonePill tone={tone} className="ml-auto">{m.status === 'excluded' ? 'Excluded' : TIER_LABEL[m.tier]}</TonePill>
      </div>
      <div className="relative h-2 w-full rounded-full bg-surface-2" aria-hidden>
        {/* the 10–20 sets/week band most recreational lifters target */}
        <span className="absolute inset-y-0 rounded-full bg-success-soft" style={{ left: pct(RECOMMENDED_RANGE.min), width: `calc(${pct(RECOMMENDED_RANGE.max)} - ${pct(RECOMMENDED_RANGE.min)})` }} />
        <span className={`absolute inset-y-0 left-0 rounded-full ${BAR_FILL[tone]}`} style={{ width: pct(m.weeklySets) }} />
      </div>
      <p className="text-meta text-fg-muted">
        {m.advice}
        {m.landmarks && m.status !== 'excluded' && <span className="text-fg-faint"> · RP guide {m.landmarks.mev}–{m.landmarks.mav} sets ({m.rpBandLabel.toLowerCase()})</span>}
      </p>
    </li>
  )
}

/** What the current program plans per muscle per week, read against the
 *  dose-response research, with your priorities and limitations applied. */
export function PlannedVolumeCard({ muscles, passes }: { muscles: MuscleRead[]; passes: number }) {
  const [prefsOpen, setPrefsOpen] = useState(false)
  const scale = Math.max(SCALE_FLOOR, ...muscles.map(m => m.weeklySets))
  return (
    <Card className="max-w-2xl">
      <CardHeader
        wrap
        icon={<BarChart3 />}
        title={<span className="inline-flex items-center gap-1.5">Planned sets per muscle
          <InfoBubble>
            <b>How it&apos;s counted.</b> Each routine&apos;s working sets (warm-ups excluded) × how often it runs a week
            ({passes}×). A set counts 1 for the exercise&apos;s main muscle and ½ for each helper muscle — the counting that fitted
            best in the largest dose-response analysis.
            <span className="mt-1.5 block"><b>Tiers (trial-based):</b> under 4 sets/week is below the minimum effective dose;
            5–10 is the most efficient range; each band above still adds a little, at a rising cost per set, with no clear
            plateau. ≥10 sets a week is linked to more growth; 10–20 suits most recreational lifters (the green band on the bars).</span>
            <span className="mt-1.5 block"><b>RP guide (heuristic):</b> the MEV–MAV figures are a coaching convention, not a trial
            result, adjusted ±15% for your experience level.</span>
            <span className="mt-1.5 block"><SourceNote ids={['pelland2025', 'acsm2026', 'bazValle2022', 'schoenfeld2017']} /></span>
          </InfoBubble>
        </span>}
        subtitle="From your routines' own prescriptions — what you plan, not what you did"
      />
      {muscles.every(m => m.weeklySets === 0) ? (
        <p className="text-meta text-fg-muted">No planned sets yet — pick your current program above.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {muscles.map(m => <MuscleRow key={m.slug} m={m} scale={scale} />)}
        </ul>
      )}
      <div className="mt-2 border-t border-line pt-2">
        <button type="button" aria-expanded={prefsOpen} onClick={() => setPrefsOpen(v => !v)} className="btn-ghost btn-sm -ml-2 gap-1 px-2 text-meta">
          <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${prefsOpen ? 'rotate-180' : ''}`} />
          Muscle preferences
        </button>
        {prefsOpen && <div className="mt-2"><MusclePreferencesList /></div>}
      </div>
    </Card>
  )
}
