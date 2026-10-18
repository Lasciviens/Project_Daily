import { Plus } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, Card, CardHeader } from '../../../shared/ui'
import type { Task } from '../../todo/types'
import { nextSortOrder, phaseTasks } from '../projectModel'
import { AddTaskInline } from './AddTaskInline'
import { PhaseCard } from './PhaseCard'
import { PhaseColumns } from './PhaseColumns'
import { ProjectTaskRow } from './ProjectTaskRow'
import type { Project, ProjectPhase } from '../types'

/**
 * The plan: the phases in their order, dealt into columns by the plan's own
 * width (two from 61rem, three from 92rem), each with its tasks; tasks in no
 * phase under "Other tasks". With no phases yet it is one task list.
 */
export function ProjectPlan({ project, phases, tasks, currentId, focusAdd }: {
  project: Project
  phases: ProjectPhase[]
  tasks: Task[]
  currentId: string | null
  /** Bumped by the header's "Task" button: the current phase opens with its add box focused. */
  focusAdd: number
}) {
  const modal = useEntityModal()
  const area = project.area ?? 'personal'
  const loose = phaseTasks(tasks, null)
  // "Task" adds to the current phase; with every phase done (or none), to "Other tasks".
  const addTarget = currentId ?? 'loose'
  const addPhase = () => modal.open({ kind: 'project-phase', projectId: project.id })

  const items = phases.map((p, i) => ({
    key: `${p.id}-${p.id === addTarget ? focusAdd : 0}`,
    node: (
      <PhaseCard phase={p} index={i} tasks={phaseTasks(tasks, p.id)} phases={phases} current={p.id === currentId} area={area}
        focusAdd={focusAdd > 0 && p.id === addTarget} />
    ),
  }))

  return (
    <Card id="plan" className="scroll-mt-24">
      <CardHeader
        variant="label"
        title={phases.length ? `Plan · ${phases.length} phase${phases.length === 1 ? '' : 's'}` : 'Plan'}
        action={<Button variant="ghost" size="sm" icon={<Plus />} onClick={addPhase}>Phase</Button>}
      />
      {phases.length > 0 && <PhaseColumns items={items} />}
      {(loose.length > 0 || addTarget === 'loose') && (
        <section className={phases.length ? 'mt-3 border-t border-line pt-2' : ''} aria-label="Other tasks">
          {phases.length > 0 && <h3 className="section-label px-1.5 pb-1">Other tasks</h3>}
          {loose.length > 0 && <ul className="flex flex-col">{loose.map(t => <ProjectTaskRow key={t.id} task={t} phases={phases} />)}</ul>}
          <AddTaskInline key={addTarget === 'loose' ? focusAdd : 0} projectId={project.id} phaseId={null} area={area}
            nextOrder={nextSortOrder(loose)} autoFocus={focusAdd > 0 && addTarget === 'loose'} />
        </section>
      )}
      {phases.length === 0 && (
        <p className="mt-2 px-1.5 text-meta text-fg-muted">Split the work into phases, each with what has to be true to call it done.</p>
      )}
    </Card>
  )
}
