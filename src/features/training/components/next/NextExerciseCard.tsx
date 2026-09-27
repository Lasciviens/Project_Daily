import { useState } from 'react'
import { ChevronDown, Timer } from 'lucide-react'
import { Card, TonePill } from '../../../../shared/ui'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { ExerciseThumb } from '../../exerciseMedia'
import { actionLabel, nextTargetUnavailableText } from '../../progress-engine/copy'
import { fmtTrainingDate } from '../../dateFormat'
import { formatPlates } from '../../plan/warmup'
import { ACTION_TONE } from '../../plan/actionTone'
import type { PlanRow } from '../../plan/sessionPlan'
import { SourceNote } from '../program/SourceNote'

function fmtRest(seconds: number): string {
  if (seconds < 60) return `${seconds}s rest`
  const m = Math.floor(seconds / 60), s = seconds % 60
  return s ? `${m}m ${s}s rest` : `${m} min rest`
}

function WarmupList({ row }: { row: PlanRow }) {
  const [open, setOpen] = useState(false)
  if (row.warmup.length === 0) return null
  return (
    <div className="border-t border-line pt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="btn-ghost btn-sm -ml-2 gap-1 px-2 text-meta">
        <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        Warm-up · {row.warmup.length} {row.warmup.length === 1 ? 'set' : 'sets'} before {row.topSetKg} kg
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-2">
          <ol className="flex flex-col gap-1">
            {row.warmup.map((w, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-body tabular-nums text-fg-2">
                <span className="font-semibold text-fg">{w.weightKg} kg × {w.reps}</span>
                <span className="text-meta text-fg-muted">{w.label}</span>
                {w.platesPerSide.length > 0 && <span className="text-meta text-fg-muted">· per side {formatPlates(w.platesPerSide)}</span>}
              </li>
            ))}
          </ol>
          <p className="text-meta text-fg-muted">
            A coaching convention: a few lighter, lower-rep sets ramp you up without tiring you. Rounded to plates you can load
            (20 kg bar, 1.25 kg smallest plate) or the rack/stack step.
          </p>
          <SourceNote ids={['mccrary2015']} prefix="Evidence for warming up" />
        </div>
      )}
    </div>
  )
}

/** One exercise of the next session: GIF, what the program prescribes, the
 *  engine's set-by-set target, last session and the warm-up ramp. */
export function NextExerciseCard({ row }: { row: PlanRow }) {
  const d = row.decision
  return (
    <Card padded={false} className="flex flex-col gap-2 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-5 shrink-0 text-right text-meta font-semibold tabular-nums text-fg-faint">{row.order}</span>
        <ExerciseThumb title={row.title} templateId={row.templateId} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold leading-snug text-fg">{row.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-fg-muted">
            {row.prescription && <span className="chip">{row.prescription}</span>}
            {row.restSeconds != null && <span className="inline-flex items-center gap-1"><Timer aria-hidden className="h-3.5 w-3.5" />{fmtRest(row.restSeconds)}</span>}
            {d && <TonePill tone={ACTION_TONE[d.currentAction]}>{actionLabel(d.currentAction)}</TonePill>}
          </div>
        </div>
      </div>

      <div className="rounded-row bg-surface-2 px-3 py-2">
        <p className="section-label flex items-center gap-1.5">
          Target
          <InfoBubble>
            <b>Where this target comes from.</b> The progress engine compares your last comparable sessions of this exercise with
            its rep target (your override, else the routine&apos;s, else a labelled default) and uses double progression: add reps
            at the same load until every set reaches the top of the range, then add load. Each set keeps its own load, so a
            backoff set stays at the backoff weight.
            <span className="mt-1.5 block"><SourceNote ids={['acsm2009', 'plotkin2022']} /></span>
          </InfoBubble>
        </p>
        {row.target ? (
          <>
            <p className="mt-0.5 text-lead font-semibold tabular-nums text-fg">{row.target}</p>
            {row.targetHeadline && <p className="text-meta text-fg-muted">{row.targetHeadline}</p>}
          </>
        ) : (
          <>
            <p className="mt-0.5 text-body font-semibold tabular-nums text-fg">{row.routineLoads ?? row.prescription ?? 'As planned in the routine'}</p>
            <p className="text-meta text-fg-muted">
              {d ? nextTargetUnavailableText(d) : 'No history for this exercise in your current program yet — this is the routine\'s own plan.'}
            </p>
          </>
        )}
      </div>

      {row.lastSets && (
        <p className="text-meta text-fg-muted">
          Last time{row.lastDate ? ` (${fmtTrainingDate(row.lastDate + 'T12:00:00')})` : ''}:{' '}
          <span className="font-medium tabular-nums text-fg-2">{row.lastSets}</span>
        </p>
      )}
      {row.notes && <p className="text-meta italic text-fg-muted">{row.notes}</p>}

      <WarmupList row={row} />
    </Card>
  )
}
