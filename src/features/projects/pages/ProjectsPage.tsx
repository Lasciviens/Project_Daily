import { useState, useEffect } from 'react'
import { useProjects } from '../hooks/useProjects'
import { ProjectList } from '../components/ProjectList'
import { ProjectDetail } from '../components/ProjectDetail'

export function ProjectsPage() {
  const { data: projects = [], isLoading } = useProjects()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId && projects.length > 0) setSelectedId(projects[0].id)
  }, [projects, selectedId])

  const selected = projects.find(p => p.id === selectedId) ?? null

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] overflow-visible lg:overflow-hidden">
      <div className="w-full lg:w-52 lg:flex-shrink-0 border-b lg:border-b-0 lg:border-r border-ink-200 bg-white flex flex-col max-h-56 lg:max-h-none overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-6 bg-ink-100 rounded animate-pulse" />)}
          </div>
        ) : (
          <ProjectList
            projects={projects}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
        )}
      </div>

      <div className="flex-1 min-w-0 bg-cream-50 overflow-visible lg:overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex-1 min-h-[240px] flex items-center justify-center text-ink-400 text-sm px-4 text-center">
            Select a project
          </div>
        ) : (
          <ProjectDetail
            key={selected.id}
            project={selected}
            onDelete={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}
