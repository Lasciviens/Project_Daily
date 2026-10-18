import { useMemo, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FolderKanban, Plus } from 'lucide-react'
import { Button, EmptyState, PageContainer, PageHeader, SegmentedControl, Skeleton } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { useAllPhases, useOpenQuestions, useProjectTasks, useProjects } from '../hooks/useProjects'
import { ProjectCard } from '../components/ProjectCard'
import { ProjectsHeroArt } from '../components/ProjectsHeroArt'
import { projectsHeaderCapRem } from '../projectBoard'
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

  const projects = projectsQ.data ?? []
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

  // The header stops over the last card (New project floated ~44rem past four cards at 2450).
  const { ref: widthRef, width } = useElementWidthRem<HTMLDivElement>()
  const headerCap = width == null ? null : projectsHeaderCapRem(projectsQ.isLoading ? 6 : shown.length, width)
  const loading = projectsQ.isLoading
  const newProject = () => modal.open({ kind: 'project' })

  return (
    <PageContainer>
      <div ref={widthRef}>
        <div className="sm:max-w-[var(--header-cap)]" style={headerCap != null ? { '--header-cap': `${headerCap}rem` } as CSSProperties : undefined}>
          <PageHeader
            title="Projects"
            art={<ProjectsHeroArt />}
            actions={projects.length > 0 || loading ? (
              <div className="flex items-center gap-2">
                {twoAreas && (
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
            {projects.length > 0 && (
              <SegmentedControl<ProjectStatus>
                size="sm"
                value={status}
                onChange={v => set('status', v, 'active')}
                options={STATUS_ORDER.map(s => ({
                  value: s,
                  label: <>{STATUS_LABEL[s]}{tally[s] > 0 && s !== status && <span className="ml-1 text-fg-faint tabular-nums">{tally[s]}</span>}</>,
                }))}
              />
            )}
          </PageHeader>
        </div>
      </div>

      {loading ? (
        <div className={GRID}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-40" />)}
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
        <div className={GRID}>
          {shown.map(p => <ProjectCard key={p.id} project={p} summary={summaries.get(p.id)!} />)}
          {shown.length === 0 && (
            <p className="text-body text-fg-muted">No {STATUS_LABEL[status].toLowerCase()} projects{area !== 'all' ? ` in ${AREA_LABEL[area]}` : ''}.</p>
          )}
        </div>
      )}
    </PageContainer>
  )
}
