import { useState } from 'react'
import { FolderKanban, Plus } from 'lucide-react'
import { Button, EmptyState, PageContainer, PageHeader, Skeleton } from '../../../shared/ui'
import { useProjects, useProjectStats, useCreateProject } from '../hooks/useProjects'
import { ProjectCard } from '../components/ProjectCard'
import { ProjectDetail } from '../components/ProjectDetail'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(19rem,22rem))] justify-start items-start gap-3 sm:gap-4'

export function ProjectsPage() {
  const { data: projects = [], isLoading, isError, refetch } = useProjects()
  const { data: stats = {} } = useProjectStats()
  const createProject = useCreateProject()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = projects.find(p => p.id === selectedId) ?? null
  const activeCount = projects.filter(p => p.status === 'active').length

  async function handleNew() {
    try {
      const p = await createProject.mutateAsync({ name: 'New project' })
      setSelectedId(p.id)
    } catch { /* the hook already toasted */ }
  }

  if (selected) {
    return (
      <PageContainer>
        <ProjectDetail
          key={selected.id}
          project={selected}
          onBack={() => setSelectedId(null)}
          onDelete={() => setSelectedId(null)}
        />
      </PageContainer>
    )
  }

  const newButton = (
    <Button variant="primary" icon={<Plus />} onClick={handleNew} loading={createProject.isPending}>New project</Button>
  )

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        subtitle={projects.length > 0 ? `${activeCount} active · ${projects.length} total` : undefined}
        actions={projects.length > 0 ? newButton : undefined}
      />

      {isLoading ? (
        <div className={GRID}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} rounded="rounded-card" className="h-32" />)}
        </div>
      ) : isError ? (
        <EmptyState
          className="max-w-md"
          bordered
          title="Couldn't load your projects"
          action={<Button size="sm" onClick={() => { void refetch() }}>Try again</Button>}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          className="max-w-md"
          bordered
          icon={<FolderKanban />}
          title="No projects yet"
          description="Create your first project to start tracking phases and items."
          action={newButton}
        />
      ) : (
        <div className={GRID}>
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} stat={stats[p.id]} onOpen={() => setSelectedId(p.id)} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
