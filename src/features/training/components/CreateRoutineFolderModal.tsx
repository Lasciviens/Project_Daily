import { useState } from 'react'
import { ModalShell } from '../../../shared/modals'
import { Button } from '../../../shared/ui'
import { useCreateHevyRoutineFolder } from '../hooks/useHevyRoutines'
import { HEVY_TITLE_MAX, routineFolderTitle } from '../hevyEnums'

/**
 * Routines → New folder: a routine folder made in Hevy (POST
 * /v1/routine_folders — Hevy puts it first), read back by id and stored
 * here, so the routine editor's Folder list offers it at once.
 */
export function CreateRoutineFolderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateHevyRoutineFolder()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = () => { setTitle(''); setError(null); onClose() }
  async function submit() {
    const checked = routineFolderTitle(title)
    if ('error' in checked) { setError(checked.error); return }
    try { await create.mutateAsync(checked.title) } catch { return }
    close()
  }

  return (
    <ModalShell
      open={open}
      onClose={close}
      title="New folder"
      size="xs"
      dismissible={!create.isPending}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={close} disabled={create.isPending} className="w-full sm:w-auto">Cancel</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending} className="w-full sm:w-auto">Create folder</Button>
        </div>
      }
    >
      <form onSubmit={e => { e.preventDefault(); void submit() }}>
        <label htmlFor="new-folder-title" className="field-label">Folder name</label>
        <input id="new-folder-title" type="text" value={title} maxLength={HEVY_TITLE_MAX} autoFocus
          onChange={e => { setTitle(e.target.value); setError(null) }} placeholder="e.g. Push Pull Legs" className="input w-full" />
        {error && <p role="alert" className="mt-2 text-meta text-danger">{error}</p>}
      </form>
    </ModalShell>
  )
}
