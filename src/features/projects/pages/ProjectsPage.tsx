import { useState } from 'react'
import { useProjects, useProjectStats, useCreateProject } from '../hooks/useProjects'
import { ProjectCard } from '../components/ProjectCard'
import { ProjectDetail } from '../components/ProjectDetail'

export function ProjectsPage() {
  const { data: projects = [], isLoading } = useProjects()
  const { data: stats = {} }               = useProjectStats()
  const createProject                      = useCreateProject()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = projects.find(p => p.id === selectedId) ?? null
  const activeCount = projects.filter(p => p.status === 'active').length

  async function handleNew() {
    const p = await createProject.mutateAsync({ name: 'New project' })
    setSelectedId(p.id)
  }

  // ─── Detail view ──────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <ProjectDetail
          key={selected.id}
          project={selected}
          onBack={() => setSelectedId(null)}
          onDelete={() => setSelectedId(null)}
        />
      </div>
    )
  }

  // ─── Grid (landing) ───────────────────────────────────────────────────────
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <h1 className="text-lg font-bold text-ink-900">Projects</h1>
        {projects.length > 0 && (
          <span className="text-xs font-medium text-ink-600 bg-white/70 px-2 py-0.5 rounded-full border border-ink-200">
            {activeCount} active · {projects.length} total
          </span>
        )}
        <button
          type="button"
          onClick={handleNew}
          disabled={createProject.isPending}
          className="ml-auto min-h-[44px] px-4 bg-accent-600 text-white text-sm font-semibold rounded-xl hover:bg-accent-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <span className="text-base leading-none">+</span>
          <span>New Project</span>
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-5xl">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-white/40 animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="max-w-md bg-cream-50 border border-dashed border-ink-200 rounded-2xl text-center py-14 px-6">
          <p className="text-3xl mb-2">🗂️</p>
          <p className="text-ink-700 font-semibold text-sm">No projects yet</p>
          <p className="text-ink-400 text-xs mt-1 mb-4">Create your first project to start tracking phases and items.</p>
          <button
            type="button"
            onClick={handleNew}
            disabled={createProject.isPending}
            className="min-h-[44px] px-4 bg-accent-600 text-white text-sm font-semibold rounded-xl hover:bg-accent-700 transition-colors disabled:opacity-50"
          >
            + New Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-5xl items-start">
          {projects.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              stat={stats[p.id]}
              onOpen={() => setSelectedId(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
