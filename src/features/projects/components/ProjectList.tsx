import { InlineText } from './InlineText'
import { useCreateProject, useUpdateProject } from '../hooks/useProjects'
import type { Project } from '../types'

const COLOR_DOT: Record<string, string> = {
  slate:   'bg-slate-400',
  blue:    'bg-blue-400',
  violet:  'bg-violet-400',
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  rose:    'bg-rose-400',
}

const STATUS_OPACITY: Record<string, string> = {
  active:    '',
  on_hold:   'opacity-60',
  completed: 'opacity-50',
  archived:  'opacity-40',
}

interface Props {
  projects:         Project[]
  selectedId:       string | null
  onSelect:         (id: string) => void
}

export function ProjectList({ projects, selectedId, onSelect }: Props) {
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()

  async function handleNew() {
    const p = await createProject.mutateAsync({ name: 'New project' })
    onSelect(p.id)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-ink-100">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Projects</p>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {projects.map(p => (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 transition-colors ${
              selectedId === p.id
                ? 'bg-accent-50 border-l-2 border-accent-500'
                : 'hover:bg-ink-100 border-l-2 border-transparent'
            } ${STATUS_OPACITY[p.status] ?? ''}`}
          >
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${COLOR_DOT[p.color] ?? 'bg-ink-300'}`} />
            <InlineText
              value={p.name}
              onSave={name => updateProject.mutate({ id: p.id, patch: { name } })}
              className={`text-sm flex-1 min-w-0 truncate block ${
                selectedId === p.id ? 'text-accent-700 font-medium' : 'text-ink-700'
              }`}
              inputClass="text-sm text-ink-700 w-full"
            />
          </div>
        ))}

        {projects.length === 0 && (
          <p className="text-xs text-ink-300 px-4 py-3">No projects yet</p>
        )}
      </div>

      <div className="px-3 py-2 border-t border-ink-100">
        <button
          onClick={handleNew}
          disabled={createProject.isPending}
          className="w-full text-xs text-accent-600 hover:text-accent-700 py-1.5 rounded hover:bg-accent-50 transition-colors text-left px-2"
        >
          + New project
        </button>
      </div>
    </div>
  )
}
