import { useState } from 'react'
import { formatSet } from '../../setFormat'
import type { TopSet } from '../../workoutSessionStats'
import type { HevyWorkoutExercise } from '../../types.hevy'
import { ExerciseRow } from './ExerciseRow'
import { SetTable } from './SetTable'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A logged workout's exercises, one collapsed line each ("3 sets · top
 *  87.5 kg × 8"); a tap shows that exercise's notes and every set. */
export function SessionExerciseRows({ exercises, topSets }: { exercises: readonly HevyWorkoutExercise[]; topSets: readonly TopSet[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const topById = new Map(topSets.map(t => [t.exerciseId, t]))

  return (
    <ul>
      {[...exercises].sort((a, b) => a.index - b.index).map(ex => {
        const sets = ex.sets ?? []
        const working = sets.filter(s => s.type !== 'warmup').length
        const warmups = sets.length - working
        const top = topById.get(ex.id)
        const meta = [
          plural(working, 'set'),
          warmups > 0 ? `+${warmups} warm-up` : null,
          top ? `top ${formatSet(top.set, top.type)}` : null,
        ].filter(Boolean).join(' · ')
        return (
          <ExerciseRow key={ex.id} title={ex.title} templateId={ex.exercise_template_id} meta={meta} open={open.has(ex.id)} onToggle={() => toggle(ex.id)}>
            {ex.notes && <p className="mb-2 whitespace-pre-line text-meta text-fg-muted">{ex.notes}</p>}
            {sets.length > 0
              ? <SetTable sets={sets} exerciseType={ex.template?.type} />
              : <p className="text-meta text-fg-muted">No sets logged.</p>}
          </ExerciseRow>
        )
      })}
    </ul>
  )
}
