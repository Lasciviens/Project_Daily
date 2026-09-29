import { useState } from 'react'
import { Timer } from 'lucide-react'
import { Skeleton, ToneDot, TonePill } from '../../../../shared/ui'
import { actionLabel, nextTargetUnavailableText } from '../../progress-engine/copy'
import { fmtTrainingDate } from '../../dateFormat'
import { ACTION_TONE } from '../../plan/actionTone'
import type { PlanRow } from '../../plan/sessionPlan'
import { ExerciseRow } from './ExerciseRow'

function fmtRest(seconds: number): string {
  if (seconds < 60) return `${seconds}s rest`
  const m = Math.floor(seconds / 60), s = seconds % 60
  return s ? `${m}m ${s}s rest` : `${m} min rest`
}

/** The collapsed line: the engine's target, else what the routine itself
 *  plans. While the engine is still running the line is a placeholder, so a
 *  routine plan never flashes into a different target. */
function targetLine(r: PlanRow): string {
  if (r.target) return `Target ${r.target}`
  const plan = r.routineLoads ?? r.prescription
  return plan ? `Planned ${plan}` : 'As planned in the routine'
}

/**
 * A planned session's exercises with the progress engine's targets — the
 * same rows as Training → Next (useRoutineSessionPlan). One line each; a tap
 * shows the prescription, rest, the engine's call and last time.
 */
export function PlannedExerciseRows({ rows, targetsLoading }: { rows: readonly PlanRow[]; targetsLoading: boolean }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <ul>
      {rows.map(r => {
        const key = `${r.templateId}-${r.order}`
        const d = r.decision
        return (
          <ExerciseRow
            key={key}
            title={r.title}
            templateId={r.templateId}
            meta={targetsLoading ? <Skeleton className="mt-1 h-3 w-28" /> : targetLine(r)}
            open={open.has(key)}
            onToggle={() => toggle(key)}
          >
            <div className="flex flex-col gap-1.5 text-meta">
              <div className="flex flex-wrap items-center gap-1.5 text-fg-muted">
                {r.prescription && <span className="chip">{r.prescription}</span>}
                {r.restSeconds != null && <span className="inline-flex items-center gap-1"><Timer aria-hidden className="h-3.5 w-3.5" />{fmtRest(r.restSeconds)}</span>}
                {d && <TonePill tone={ACTION_TONE[d.currentAction]}>{actionLabel(d.currentAction)}</TonePill>}
              </div>
              {!targetsLoading && (
                r.target
                  ? r.targetHeadline && <p className="text-fg-2">{r.targetHeadline}</p>
                  : <p className="text-fg-muted">{d ? nextTargetUnavailableText(d) : 'No history for this exercise in your current program yet — this is the routine’s own plan.'}</p>
              )}
              {r.lastSets && (
                <p className="text-fg-muted">
                  Last time{r.lastDate ? ` (${fmtTrainingDate(r.lastDate + 'T12:00:00')})` : ''}:{' '}
                  <span className="font-medium tabular-nums text-fg-2">{r.lastSets}</span>
                </p>
              )}
              {r.lastEffort?.note && r.lastEffort.text && (
                <p className="flex items-start gap-2 text-fg-2"><ToneDot tone="info" className="mt-1 shrink-0" />{r.lastEffort.text}</p>
              )}
            </div>
          </ExerciseRow>
        )
      })}
    </ul>
  )
}
