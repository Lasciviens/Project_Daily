import { Card, SectionLabel, useChartColors } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import type { Balance } from './muscleVolumeModel'

function RatioRow({ label, a, b, warn, verdict, bubble }: { label: string; a: number; b: number; warn: boolean; verdict: string; bubble: React.ReactNode }) {
  const c = useChartColors()
  const total = a + b || 1
  const pa = Math.round((a / total) * 100)
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between gap-2 text-meta">
        <span className="flex items-center gap-1 text-fg-2">{label} <InfoBubble>{bubble}</InfoBubble></span>
        <span data-tone={warn ? 'warn' : 'success'} className={warn ? 'tone-text font-semibold' : 'text-fg-muted'}>{verdict}{warn ? ' ⚠' : ' ✓'}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2" title={`${a.toFixed(1)} vs ${b.toFixed(1)}`}>
        <div style={{ width: `${pa}%`, backgroundColor: c.series[0] }} />
        <div style={{ width: `${100 - pa}%`, backgroundColor: c.series[2] }} />
      </div>
    </div>
  )
}

export function MuscleBalanceCard({ balance, windowDays }: { balance: Balance; windowDays: number }) {
  if (balance.pushPull == null && balance.quadHam == null) return null
  return (
    <Card className="flex max-w-xl flex-col gap-2.5">
      <SectionLabel>Muscle balance · last {windowDays} days</SectionLabel>
      {balance.pushPull != null && (
        <RatioRow label="Push vs Pull" a={balance.push} b={balance.pull}
          warn={balance.pushPull < 0.8 || balance.pushPull > 1.25}
          verdict={balance.pushPull > 1.25 ? 'push-heavy' : balance.pushPull < 0.8 ? 'pull-heavy' : 'balanced'}
          bubble={<p><strong>Push</strong> = chest, shoulders, triceps. <strong>Pull</strong> = back, biceps, traps. Training them roughly evenly keeps your physique and posture balanced. (A rough balance guide — there's no strong evidence a specific ratio is required.)</p>} />
      )}
      {balance.quadHam != null && (
        <RatioRow label="Quads vs Hamstrings" a={balance.quad} b={balance.ham}
          warn={balance.quadHam > 1.5}
          verdict={balance.quadHam > 1.5 ? 'quad-dominant' : 'balanced'}
          bubble={<p>Front vs back of the thigh. Big quad dominance is often paired with lagging hamstrings — balance it with curls or Romanian deadlifts. (Balance guidance, not a medical claim.)</p>} />
      )}
    </Card>
  )
}
