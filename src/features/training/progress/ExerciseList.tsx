import { useMemo, useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useProgressDataContext } from './progressDataContext'
import { formatSetTargets } from '../progress-engine/format'
import type { ExerciseProgressResult, CanonicalExerciseSession, ProgressMetricKind } from '../progress-engine/types'
import { InfoBubble } from '../../../shared/components/InfoBubble'
import { Card, CardHeader, EmptyState, SegmentedControl, TonePill, Truncate, cx } from '../../../shared/ui'
import { DecisionDetail } from './decisionParts'
import { ACTION_TONE } from '../plan/actionTone'
import {
  NEXT_ACTION_GROUPS, firstGroup, groupCounts, nextActionGroup, routinesInNextOrder, rowPill, sortByNextSession, type NextActionGroup,
} from './decisionTabs'
import {
  NO_FILTERS, applyDecisionFilters, effectiveFilters, filtersActive, muscleOptions, muscleRoleFor, routineOptions,
  type DecisionFilters, type MuscleRoleInExercise,
} from './decisionFilters'
import { DecisionFilterBar } from './DecisionFilterBar'
import { useTrainingWeek } from '../hooks/useTrainingWeek'

// Results' exercise list (owner, 27.11.2026: "Yes" to one exercise list grouped by the next action): one segmented
// Group control (Add weight · Almost · Add reps · Check, with counts — every exercise is in exactly one), each row the
// exercise, its pill and its next target, sorted by the next session's order. A row opens the explanation, the
// evidence pills, the recent sessions and the chart (DecisionDetail). Search, muscle, routine, evidence and window sit
// behind one Filters disclosure. Nothing here decides anything: the engine's result (progress-engine/), grouped and
// filtered by pure functions (decisionTabs.ts, decisionFilters.ts).

/** The next session's target in the same words as Today's card (sessionPlan: formatSetTargets, else the headline). */
function targetText(r: ExerciseProgressResult): string | null {
  const next = r.nextTargets?.nextSession
  if (!next) return null
  return next.setTargets ? formatSetTargets(next.setTargets, r.metricKind) : next.headline
}

/** Under a Muscle filter: how this exercise trains the picked muscle. */
type MuscleRoleTag = { role: MuscleRoleInExercise; muscle: string }

function MuscleRoleChip({ role, muscle }: MuscleRoleTag) {
  const meaning = role === 'primary' ? `${muscle} is this exercise's primary muscle` : `${muscle} is a secondary (helper) muscle in this exercise`
  return (
    <span title={meaning} className={cx('chip shrink-0', role === 'secondary' && 'text-fg-muted')}>
      <span className="sr-only">{muscle}: </span>{role === 'primary' ? 'Primary' : 'Secondary'}
    </span>
  )
}

function ExerciseRow({ result, sessions, metricKind, title, muscleRole, groupLabel }: {
  result: ExerciseProgressResult; sessions: CanonicalExerciseSession[]; metricKind: ProgressMetricKind; title: string; muscleRole: MuscleRoleTag | null
  groupLabel: string
}) {
  const [open, setOpen] = useState(false)
  const target = targetText(result)
  const pill = rowPill(result.currentAction, result.metricKind, groupLabel)
  return (
    <li className="border-b border-line py-1.5 last:border-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} title={`${title}: why, the evidence, recent sessions and the chart`}
        className="flex w-full items-start gap-2 text-left">
        <ChevronDown aria-hidden className={`mt-1 h-4 w-4 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <Truncate className="min-w-0 text-body font-semibold text-fg">{title}</Truncate>
            {pill && <TonePill tone={ACTION_TONE[result.currentAction]} className="shrink-0">{pill}</TonePill>}
            {muscleRole && <MuscleRoleChip {...muscleRole} />}
          </span>
          <span className="block text-meta tabular-nums text-fg-2">{target ? <>Next: {target}</> : <span className="text-fg-muted">No target yet — open for why</span>}</span>
        </span>
      </button>
      {open && <DecisionDetail result={result} sessions={sessions} metricKind={metricKind} title={title} />}
    </li>
  )
}

export function ExerciseList() {
  const {
    isLoading, needsCurrentProgram, decisions, titleById, sessionsByTemplateId, metricKindByTemplateId,
    musclesByTemplateId, routineIdsByTemplateId, activeRoutines, today,
  } = useProgressDataContext()
  const { week } = useTrainingWeek()
  const [picked, setPicked] = useState<DecisionFilters>(NO_FILTERS)
  const [chosen, setChosen] = useState<NextActionGroup | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  // Options come from every decision, so a pick survives a group change.
  const muscles = useMemo(() => muscleOptions(decisions, musclesByTemplateId), [decisions, musclesByTemplateId])
  const routines = useMemo(() => routineOptions(decisions, activeRoutines, routineIdsByTemplateId), [decisions, activeRoutines, routineIdsByTemplateId])
  const filters = useMemo(() => effectiveFilters(picked, muscles, routines), [picked, muscles, routines])
  const filterData = useMemo(() => ({ titleById, musclesByTemplateId, routineIdsByTemplateId, today }), [titleById, musclesByTemplateId, routineIdsByTemplateId, today])

  // The filters narrow every group; the counts follow them, so they always add up to what the list can show.
  const filtered = useMemo(() => applyDecisionFilters(decisions, filters, filterData), [decisions, filters, filterData])
  const counts = useMemo(() => groupCounts(filtered), [filtered])
  const group = chosen ?? firstGroup(counts)
  const order = useMemo(() => routinesInNextOrder(week, activeRoutines.map(r => r.id)), [week, activeRoutines])
  const shown = useMemo(() => sortByNextSession(filtered.filter(d => nextActionGroup(d) === group), order, activeRoutines, id => titleById.get(id) ?? ''),
    [filtered, group, order, activeRoutines, titleById])

  if (isLoading || needsCurrentProgram) return null
  if (decisions.length === 0) {
    return <Card><EmptyState title="No current-program exercises logged yet" className="py-6" /></Card>
  }

  const anyFilter = filtersActive(filters)
  const muscleLabel = muscles.find(m => m.slug === filters.muscle)?.label ?? null
  const roleOf = (templateId: string): MuscleRoleTag | null => {
    if (!muscleLabel) return null
    const role = muscleRoleFor(musclesByTemplateId.get(templateId), filters.muscle)
    return role ? { role, muscle: muscleLabel } : null
  }
  const groupLabel = NEXT_ACTION_GROUPS.find(g => g.id === group)?.label ?? ''
  const words = NEXT_ACTION_GROUPS.find(g => g.id === group)?.tip.replace(/^[^:]+: /, '') ?? ''
  const meaning = words.charAt(0).toUpperCase() + words.slice(1)

  return (
    <Card className="@container flex flex-col gap-2">
      <CardHeader
        variant="label" className="!mb-0" wrap
        title={<span className="inline-flex items-center gap-1.5">Exercises by next step
          <InfoBubble label="How the list is grouped">
            Every exercise of your current program, in one group: what its next session asks for — the same pill as its card on
            Today. Sorted in the order you will do them next (the next session&apos;s routine first). Tap an exercise for why,
            how sure the read is, its recent sessions and its chart.
          </InfoBubble>
        </span>}
        action={(
          <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)} title="Filters: search, muscle, routine, evidence and window"
            className={cx('btn-ghost btn-sm gap-1.5 text-meta', anyFilter && '!text-accent-600')}>
            <SlidersHorizontal aria-hidden className="h-4 w-4" />Filters{anyFilter ? ' · on' : ''}
          </button>
        )}
      />
      {showFilters && (
        <DecisionFilterBar
          filters={filters} onChange={p => setPicked(f => ({ ...f, ...p }))} onClear={() => setPicked(NO_FILTERS)} active={anyFilter}
          muscles={muscles} routines={routines} shown={filtered.length} total={decisions.length}
        />
      )}
      {/* Four groups in one row; below 22rem of the card's own width two rows of two, so no group is ever cut off or
          scrolled out of sight (a 360px phone, big counts). */}
      <div className="[&_.seg]:grid-flow-row [&_.seg]:grid-cols-2 @[22rem]:[&_.seg]:grid-flow-col @[22rem]:[&_.seg]:grid-cols-none">
      <SegmentedControl<NextActionGroup>
        size="sm" fit fullWidth label="Group" value={group} onChange={setChosen}
        options={NEXT_ACTION_GROUPS.map(g => ({
          value: g.id, tip: `${g.tip} ${counts[g.id]} ${counts[g.id] === 1 ? 'exercise' : 'exercises'}.`,
          label: <>{g.label}<span className="-ml-1 tabular-nums text-fg-muted">{counts[g.id]}</span></>,
        }))}
      />
      </div>
      <p className="text-meta text-fg-muted">{meaning}</p>
      {shown.length === 0 ? (
        <p className="py-3 text-center text-body text-fg-muted">{anyFilter ? 'No exercises in this group match the filters.' : 'No exercises in this group right now.'}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map(d => (
            <ExerciseRow
              key={d.exerciseTemplateId} result={d}
              sessions={sessionsByTemplateId.get(d.exerciseTemplateId) ?? []}
              metricKind={metricKindByTemplateId.get(d.exerciseTemplateId) ?? 'est1rm'}
              title={titleById.get(d.exerciseTemplateId) ?? 'Unknown exercise'}
              muscleRole={roleOf(d.exerciseTemplateId)}
              groupLabel={groupLabel}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}
