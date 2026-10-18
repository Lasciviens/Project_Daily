import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useCreateProjectTask } from '../hooks/useProjects'
import type { ProjectArea } from '../types'

/** "Add a task" under a phase: type and press Enter; the box stays for the next one. */
export function AddTaskInline({ projectId, phaseId, area, nextOrder, autoFocus }: {
  projectId: string; phaseId: string | null; area: ProjectArea; nextOrder: number; autoFocus?: boolean
}) {
  const create = useCreateProjectTask()
  const [title, setTitle] = useState('')

  async function add() {
    const t = title.trim()
    if (!t || create.isPending) return
    try {
      await create.mutateAsync({ input: { project_id: projectId, project_phase_id: phaseId, title: t, domain: area }, sortOrder: nextOrder })
      setTitle('')
    } catch { /* the hook said what failed */ }
  }

  return (
    <form className="flex items-center gap-2 px-1.5" onSubmit={e => { e.preventDefault(); void add() }}>
      <Plus aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        autoFocus={autoFocus}
        maxLength={300}
        aria-label="Add a task"
        placeholder="Add a task"
        className="input-bare min-w-0 flex-1 py-1.5 text-body"
      />
    </form>
  )
}
