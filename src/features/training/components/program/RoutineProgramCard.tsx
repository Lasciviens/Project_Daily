import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Card, CardHeader, MetaLine, TonePill, Truncate } from '../../../../shared/ui'
import { ExerciseThumb } from '../../exerciseMedia'
import { routineTargetFromSets, repRangeLabel } from '../../progress-engine'
import { openPlanRoutine } from '../../planTraining'
import type { HevyRoutine } from '../../types.hevy'
import type { ExerciseTargetOverride } from '../../types.athlete'
import { TargetOverrideEditor } from './TargetOverrideEditor'

/** One current-program routine: every exercise with its sets and rep target,
 *  and where that target comes from (your override or the routine). */
export function RoutineProgramCard({ routine, overrides, lastDoneText }: {
  routine: HevyRoutine
  overrides: ReadonlyMap<string, ExerciseTargetOverride>
  lastDoneText: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const exercises = [...(routine.exercises ?? [])].sort((a, b) => a.index - b.index)
  const totalSets = exercises.reduce((s, ex) => s + (ex.sets ?? []).filter(x => x.type !== 'warmup').length, 0)
  return (
    <Card>
      <CardHeader
        wrap
        title={routine.title}
        subtitle={<MetaLine as="span" items={[`${exercises.length} exercises`, `${totalSets} working sets`, `last done ${lastDoneText}`]} />}
        action={<button type="button" className="min-h-[44px] text-meta font-semibold text-accent-600" onClick={() => openPlanRoutine(routine)}>Plan</button>}
      />
      <ul className="flex flex-col divide-y divide-line">
        {exercises.map(ex => {
          const sets = ex.sets ?? []
          const rt = routineTargetFromSets(sets)
          const override = overrides.get(ex.exercise_template_id) ?? null
          const warmups = sets.filter(s => s.type === 'warmup').length
          const isEditing = editing === ex.id
          return (
            <li key={ex.id} className="py-2">
              <div className="flex items-center gap-3">
                <ExerciseThumb title={ex.title} templateId={ex.exercise_template_id} size={40} />
                <div className="min-w-0 flex-1">
                  <Truncate as="p" className="text-body font-medium text-fg">{ex.title}</Truncate>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-meta tabular-nums text-fg-muted">
                    {rt || override
                      ? <span>{rt?.targetSets ?? sets.filter(s => s.type !== 'warmup').length} × {repRangeLabel(override?.rep_range_start ?? rt?.repMin ?? 0, override?.rep_range_end ?? rt?.repMax ?? 0)}</span>
                      : <span>{sets.length - warmups} {sets.length - warmups === 1 ? 'set' : 'sets'}, no rep target</span>}
                    {warmups > 0 && <span>· {warmups} warm-up</span>}
                    {override && <TonePill tone="highlight">Your target</TonePill>}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Set your own rep target for ${ex.title}`}
                  aria-expanded={isEditing}
                  onClick={() => setEditing(isEditing ? null : ex.id)}
                  className="icon-btn shrink-0 text-fg-muted"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              </div>
              {isEditing && (
                <TargetOverrideEditor
                  templateId={ex.exercise_template_id}
                  title={ex.title}
                  current={override}
                  fallback={rt ? { repMin: rt.repMin, repMax: rt.repMax } : null}
                  onDone={() => setEditing(null)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
