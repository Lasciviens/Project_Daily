import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, FolderKanban } from 'lucide-react'
import { Button, EmptyState, PageBoard, PageContainer, PageHeader, Skeleton, useBoardStep } from '../../../shared/ui'
import type { Task } from '../../todo/types'
import { useAllPhases, useBlocks, useEntries, useProjectTasks, useProjects } from '../hooks/useProjects'
import { isOpenQuestion, orderPhases, projectSummary, tableSettings } from '../projectModel'
import { PROJECT_BOARD, blockTrack, type ProjectSection } from '../projectBoard'
import { BlockCard } from '../components/BlockCard'
import { ProjectHeaderCard } from '../components/ProjectHeaderCard'
import { ProjectPlan } from '../components/ProjectPlan'
import { SectionChips } from '../components/SectionChips'
import type { Project, ProjectBlock, ProjectEntry, ProjectPhase } from '../types'

/** One project's own page (/projects/:projectId): its header, its plan and its blocks. */
export function ProjectPage() {
  const { projectId = '' } = useParams()
  const projectsQ = useProjects()
  const phasesQ = useAllPhases()
  const tasksQ = useProjectTasks()
  const blocksQ = useBlocks(projectId)
  const entriesQ = useEntries(projectId)
  const project = projectsQ.data?.find(p => p.id === projectId)

  if (projectsQ.isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Project" />
        <div className="flex max-w-[56rem] flex-col gap-4">
          <Skeleton rounded="rounded-card" className="h-44" />
          <Skeleton rounded="rounded-card" className="h-64" />
        </div>
      </PageContainer>
    )
  }
  if (!project) {
    return (
      <PageContainer>
        <PageHeader title="Project" />
        <EmptyState
          className="max-w-md" bordered icon={<FolderKanban />}
          title={projectsQ.isError ? "Couldn't load this project" : 'This project isn’t here any more'}
          description={projectsQ.isError ? undefined : 'It may have been deleted.'}
          action={projectsQ.isError
            ? <Button size="sm" onClick={() => { void projectsQ.refetch() }}>Try again</Button>
            : <Link to="/projects" className="btn-secondary btn-sm">All projects</Link>}
        />
      </PageContainer>
    )
  }

  return (
    <ProjectBoardView
      project={project}
      phases={(phasesQ.data ?? []).filter(p => p.project_id === project.id)}
      tasks={(tasksQ.data ?? []).filter(t => t.project_id === project.id)}
      blocks={[...(blocksQ.data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))}
      entries={entriesQ.data ?? []}
      loadingBlocks={blocksQ.isLoading}
    />
  )
}

function ProjectBoardView({ project, phases, tasks, blocks, entries, loadingBlocks }: {
  project: Project; phases: ProjectPhase[]; tasks: Task[]; blocks: ProjectBlock[]; entries: ProjectEntry[]; loadingBlocks: boolean
}) {
  const [focusAdd, setFocusAdd] = useState(0)
  const ordered = useMemo(() => orderPhases(phases), [phases])
  const summary = useMemo(
    () => projectSummary(ordered, tasks, entries.filter(isOpenQuestion).length),
    [ordered, tasks, entries],
  )
  const current = ordered.find(p => p.id === summary.current?.id) ?? null
  const logBlock = blocks.find(b => b.kind === 'log') ?? null
  const entriesOf = (b: ProjectBlock) => entries.filter(e => e.block_id === b.id)

  const onNewTask = () => {
    setFocusAdd(n => n + 1)
    document.getElementById('plan')?.scrollIntoView({ block: 'start' })
  }

  const sections: Record<ProjectSection, ReactNode> = {
    back: (
      <Link to="/projects" className="btn-ghost btn-sm -ml-3 self-start">
        <ChevronLeft aria-hidden className="h-4 w-4" /> All projects
      </Link>
    ),
    header: <ProjectHeaderCard project={project} summary={summary} current={current} logBlock={logBlock} onNewTask={onNewTask} />,
    main: (
      <MainTrack project={project} phases={ordered} tasks={tasks} blocks={blocks} entriesOf={entriesOf}
        currentId={current?.id ?? null} focusAdd={focusAdd} loadingBlocks={loadingBlocks} />
    ),
    side: <SideTrack blocks={blocks} entriesOf={entriesOf} />,
  }

  return (
    // The header card's name is the page's heading (h1): the project's name is content, not the route's.
    <PageContainer>
      <PageBoard sections={sections} layout={PROJECT_BOARD} />
    </PageContainer>
  )
}

const blockColumns = (b: ProjectBlock) => (b.kind === 'table' ? tableSettings(b.settings).columns.length : 0)

/** Main: the plan, then (on a phone) every block in order — or (wider) the text pages and wide tables. */
function MainTrack({ project, phases, tasks, blocks, entriesOf, currentId, focusAdd, loadingBlocks }: {
  project: Project; phases: ProjectPhase[]; tasks: Task[]; blocks: ProjectBlock[]
  entriesOf: (b: ProjectBlock) => ProjectEntry[]; currentId: string | null; focusAdd: number; loadingBlocks: boolean
}) {
  const step = useBoardStep()
  const here = step === 1 ? blocks : blocks.filter(b => blockTrack(b.kind, blockColumns(b)) === 'main')
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
      {step === 1 && blocks.length > 0 && (
        <SectionChips sections={[{ id: 'plan', label: 'Plan' }, ...blocks.map(b => ({ id: `block-${b.id}`, label: b.title }))]} />
      )}
      <ProjectPlan project={project} phases={phases} tasks={tasks} currentId={currentId} focusAdd={focusAdd} />
      {loadingBlocks && <Skeleton rounded="rounded-card" className="h-32" />}
      {here.map(b => <BlockCard key={b.id} block={b} entries={entriesOf(b)} blocks={blocks} />)}
    </div>
  )
}

/** Side (from the laptop up): the log, questions, links and narrow tables. */
function SideTrack({ blocks, entriesOf }: { blocks: ProjectBlock[]; entriesOf: (b: ProjectBlock) => ProjectEntry[] }) {
  const step = useBoardStep()
  if (step === 1) return null
  const here = blocks.filter(b => blockTrack(b.kind, blockColumns(b)) === 'side')
  if (here.length === 0) return null
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {here.map(b => <BlockCard key={b.id} block={b} entries={entriesOf(b)} blocks={blocks} />)}
    </div>
  )
}
