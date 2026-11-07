import { useMemo, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FolderKanban, Plus } from 'lucide-react'
import { Button, EmptyState, PageContainer, PageHeader, SegmentedControl, Skeleton } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { useRememberedCount, useRememberedFlag } from '../../../shared/hooks/useLayoutMemory'
import { useAllPhases, useOpenQuestions, useProjectTasks, useProjects } from '../hooks/useProjects'
import { ProjectCard } from '../components/ProjectCard'
import { ProjectsHeroArt } from '../components/ProjectsHeroArt'
import { projectsHeaderCapRem, projectsHeaderCards } from '../projectBoard'
import {
  AREA_LABEL, STATUS_LABEL, STATUS_ORDER, filterProjects, projectSummary, statusTally, type AreaFilter,
} from '../projectModel'
import type { ProjectStatus } from '../types'

const GRID = 'grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(19rem,22rem))] justify-start items-start gap-3 sm:gap-4'

const parseStatus = (v: string | null): ProjectStatus => (STATUS_ORDER as readonly string[]).includes(v ?? '') ? v as ProjectStatus : 'active'
const parseArea = (v: string | null): AreaFilter => (v === 'personal' || v === 'work' ? v : 'all')

export function ProjectsPage() {
  const projectsQ = useProjects()
  const phasesQ = useAllPhases()
  const tasksQ = useProjectTasks()
  const questionsQ = useOpenQuestions()
  const modal = useEntityModal()
  const [params, setParams] = useSearchParams()
  const status = parseStatus(params.get('status'))
  const area = parseArea(params.get('area'))
  const set = (key: 'status' | 'area', value: string, fallback: string) =>
    setParams(p => { const n = new URLSearchParams(p); if (value === fallback) n.delete(key); else n.set(key, value); return n }, { replace: true })

  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data])
  const shown = filterProjects(projects, status, area)
  const tally = statusTally(projects, area)
  // The area switch shows once both areas have a project (or one is picked).
  const twoAreas = area !== 'all' || (projects.some(p => p.area === 'work') && projects.some(p => (p.area ?? 'personal') === 'personal'))
  const summaries = useMemo(() => {
    const phases = phasesQ.data ?? []
    const tasks = tasksQ.data ?? []
    const questions = questionsQ.data ?? []
    return new Map(projects.map(p => [p.id, projectSummary(
      phases.filter(ph => ph.project_id === p.id),
      tasks.filter(t => t.project_id === p.id),
      questions.filter(q => q.project_id === p.id).length,
    )]))
  }, [projects, phasesQ.data, tasksQ.data, questionsQ.data])

  // A card is drawn from its project's phases, tasks and questions too (read at once, with the projects): drawn
  // before them, each card grew a "Next" row a moment later and pushed the ones under it (a layout shift).
  const loading = projectsQ.isLoading || phasesQ.isLoading || tasksQ.isLoading || questionsQ.isLoading
  // Until the cards are in, the header keeps what it had when they last loaded on this device (THEME.md §5), and it
  // changes with them, never before (shrunk first, it moved the loading cards up the page): the status switch shows
  // whenever there is a project (also the first time), the area switch only with both areas (kept for an account
  // with one, it dropped the cards when they landed), and it stops over as many cards as there were.
  const hasProjects = useRememberedFlag('projects:any', projects.length > 0, !loading, true)
  const showAreas = useRememberedFlag('projects:areas', twoAreas, !loading) || twoAreas
  const headerCards = useRememberedCount('projects:cards', projectsHeaderCards(statusTally(projects, 'all'), false), !loading, projectsHeaderCards({}, true))
  // The header stops over the last card (New project floated ~44rem past four cards at 2450) — the most
  // cards any status shows, so switching status or area never resizes it (projectsHeaderCards).
  const { ref: widthRef, width } = useElementWidthRem<HTMLDivElement>()
  const headerCap = width == null ? null : projectsHeaderCapRem(headerCards, width)
  const newProject = () => modal.open({ kind: 'project' })

  return (
    <PageContainer>
      <div ref={widthRef}>
        <div className="sm:max-w-[var(--header-cap)]" style={headerCap != null ? { '--header-cap': `${headerCap}rem` } as CSSProperties : undefined}>
          <PageHeader
            title="Projects"
            art={<ProjectsHeroArt />}
            actions={hasProjects ? (
              // A phone's row is full width with New project at its end, so the area switch arriving beside it
              // moves nothing sideways (as a right-aligned group, the whole row jumped 200px left).
              <div className="flex items-center gap-2 max-md:w-full max-md:justify-end">
                {showAreas && (
                  <SegmentedControl<AreaFilter>
                    size="sm"
                    value={area}
                    onChange={v => set('area', v, 'all')}
                    options={[{ value: 'all', label: 'All' }, { value: 'personal', label: AREA_LABEL.personal }, { value: 'work', label: AREA_LABEL.work }]}
                  />
                )}
                <Button variant="primary" icon={<Plus />} onClick={newProject}>New project</Button>
              </div>
            ) : undefined}
          >
            {hasProjects && (
              <SegmentedControl<ProjectStatus>
                size="sm"
                value={status}
                onChange={v => set('status', v, 'active')}
                options={STATUS_ORDER.map(s => ({
                  value: s,
                  // The open status keeps its count too: a label that changed on a switch moved every tab.
                  label: <>{STATUS_LABEL[s]}{tally[s] > 0 && <span className="ml-1 text-fg-faint tabular-nums">{tally[s]}</span>}</>,
                }))}
              />
            )}
          </PageHeader>
        </div>
      </div>

      {loading ? (
        // Keyed apart from the loaded grid: the cards replace the loading copy instead of moving into its place.
        <div key="loading" className={GRID}>
          {/* A loaded card's height (title, meta, progress, Next row). */}
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-[9.625rem]" />)}
        </div>
      ) : projectsQ.isError ? (
        <EmptyState
          className="max-w-md" bordered title="Couldn't load your projects"
          action={<Button size="sm" onClick={() => { void projectsQ.refetch() }}>Try again</Button>}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          className="max-w-md" bordered icon={<FolderKanban />}
          title="No projects yet"
          description="A project is a plan with phases and tasks, plus the blocks it needs: parts, a log, questions, guides, links."
          action={<Button variant="primary" icon={<Plus />} onClick={newProject}>New project</Button>}
        />
      ) : (
        <div key="cards" className={GRID}>
          {shown.map(p => <ProjectCard key={p.id} project={p} summary={summaries.get(p.id)!} />)}
          {shown.length === 0 && (
            <p className="text-body text-fg-muted">No {STATUS_LABEL[status].toLowerCase()} projects{area !== 'all' ? ` in ${AREA_LABEL[area]}` : ''}.</p>
          )}
        </div>
      )}
    </PageContainer>
  )
}
