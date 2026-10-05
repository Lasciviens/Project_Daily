import { useState } from 'react'
import { Target } from 'lucide-react'
import { Button, Card, CardHeader } from '../../../../shared/ui'
import { useSaveReadingSettings } from '../../hooks/useLibrary'
import type { ReadingSettings } from '../../types'

/** The daily goal and the streak threshold. Seeded once from the saved values (the caller keys it). */
export function GoalCard({ settings }: { settings: ReadingSettings }) {
  const save = useSaveReadingSettings()
  const [goal, setGoal] = useState(settings.daily_minutes_goal)
  const [min, setMin] = useState(settings.streak_min_minutes)
  const changed = goal !== settings.daily_minutes_goal || min !== settings.streak_min_minutes
  return (
    <Card>
      <CardHeader title="Goal" variant="label" icon={<Target />} />
      <div className="flex flex-col gap-3">
        <Stepper label="Daily goal" unit="min" value={goal} onChange={setGoal} step={5} min={5} max={240} />
        <Stepper label="A day counts for the streak from" unit="min" value={min} onChange={setMin} step={1} min={1} max={60} />
        <p className="text-micro text-fg-muted">Keep the streak threshold low: it is a habit signal, not a target. A day the Kobo has not reported never breaks it.</p>
        <Button variant="primary" size="sm" className="self-start" disabled={!changed} loading={save.isPending}
          onClick={() => save.mutate({ daily_minutes_goal: goal, streak_min_minutes: Math.min(min, goal) })}>Save goal</Button>
      </div>
    </Card>
  )
}

function Stepper({ label, unit, value, onChange, step, min, max }: {
  label: string; unit: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-body text-fg">{label}</span>
      <button type="button" className="icon-btn-bordered" aria-label={`Less ${label.toLowerCase()}`} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span className="w-16 text-center text-body font-semibold tabular-nums text-fg">{value} {unit}</span>
      <button type="button" className="icon-btn-bordered" aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  )
}
