import { useState } from 'react'
import { useProjects } from '../hooks/useProjects'
import { ProjectList } from '../components/ProjectList'
import { ProjectDetail } from '../components/ProjectDetail'

export function ProjectsPage() {
  const { data: projects = [], isLoading } = useProjects()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = projects.find(p => p.id === selectedId) ?? projects[0] ?? null

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">

      {/* ── Left panel — project list ──────────────────────────────────── */}
      <div className="w-52 flex-shrink-0 border-r border-ink-200 bg-white flex flex-col">
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

      {/* ── Right panel — project detail ───────────────────────────────── */}
      <div className="flex-1 min-w-0 bg-cream-50 overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-ink-400 text-sm">
            Select a project or create one
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
