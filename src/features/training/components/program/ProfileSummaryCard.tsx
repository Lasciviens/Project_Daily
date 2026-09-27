import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { Button, Card, CardHeader, TonePill, type Tone } from '../../../../shared/ui'
import { useAthleteProfile, useAthleteLimitations, useMusclePreferences } from '../../hooks/useAthleteProfile'
import { labelForSlug, movementPatternLabel } from '../../muscleMap'
import type { LimitationSeverity } from '../../types.athlete'
import { AthleteProfileSheet } from '../AthleteProfileSheet'

const SEVERITY_TONE: Record<LimitationSeverity, Tone> = { avoid: 'danger', limit: 'warn', monitor: 'neutral' }

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className="text-body font-medium capitalize text-fg">{value ?? '—'}</dd>
    </div>
  )
}

/** What the coach and the Program tab know about you: goal, experience,
 *  schedule, limitations and muscle preferences — edited in one sheet. */
export function ProfileSummaryCard() {
  const [open, setOpen] = useState(false)
  const { data: profile } = useAthleteProfile()
  const { data: limitations = [] } = useAthleteLimitations(true)
  const { data: prefs = [] } = useMusclePreferences()
  const days = profile?.training_days_per_week
  return (
    <Card className="w-full max-w-md xl:w-96 xl:shrink-0">
      <CardHeader icon={<UserRound />} title="Your training profile" action={<Button size="sm" onClick={() => setOpen(true)}>Edit</Button>} />
      <dl className="divide-y divide-line">
        <Row label="Goal" value={profile?.goal?.replace('_', ' ') ?? null} />
        <Row label="Experience" value={profile?.experience_level ?? null} />
        <Row label="Training days" value={days ? `${days} a week` : null} />
        <Row label="Equipment" value={profile?.equipment_access ?? null} />
      </dl>
      <div className="mt-3 border-t border-line pt-3">
        <p className="section-label mb-1.5">Active limitations</p>
        {limitations.length === 0 ? <p className="text-meta text-fg-muted">None.</p> : (
          <ul className="flex flex-col gap-1">
            {limitations.map(l => (
              <li key={l.id} className="flex items-center gap-2 text-body text-fg-2">
                <TonePill tone={SEVERITY_TONE[l.severity]}>{l.severity}</TonePill>
                <span className="min-w-0 truncate">{movementPatternLabel(l.movement_pattern)}{l.note ? ` — ${l.note}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <p className="section-label mb-1.5">Muscle preferences</p>
        {prefs.length === 0 ? <p className="text-meta text-fg-muted">None — every muscle is read the same way.</p> : (
          <ul className="flex flex-wrap gap-1.5">
            {prefs.map(p => (
              <li key={p.id}><TonePill tone={p.preference === 'priority' ? 'star' : 'neutral'}>{labelForSlug(p.muscle_slug)} · {p.preference === 'priority' ? 'priority' : 'no direct work'}</TonePill></li>
            ))}
          </ul>
        )}
      </div>
      <AthleteProfileSheet open={open} onClose={() => setOpen(false)} />
    </Card>
  )
}
