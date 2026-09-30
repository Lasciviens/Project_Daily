import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { useCreateTraktList } from '../trakt/useTraktExtras'
import type { ListItemRef } from '../trakt/traktApi'

/** Name a new Trakt list (private), optionally starting with some titles. */
export function NewListDialog({ items, onClose }: { items?: ListItemRef[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const create = useCreateTraktList()
  const submit = async () => {
    if (!name.trim()) return
    try { await create.mutateAsync({ name: name.trim(), items }); onClose() } catch { /* toasted */ }
  }
  return (
    <ModalShell
      onClose={onClose}
      size="xs"
      layer="confirm"
      title="New list"
      subtitle="A private list on your Trakt account."
      footer={<div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { void submit() }} loading={create.isPending} disabled={!name.trim()}>Create</Button>
      </div>}
    >
      <label htmlFor="new-list-name" className="field-label">Name</label>
      <input
        id="new-list-name"
        autoFocus
        value={name}
        maxLength={100}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void submit() }}
        className="input w-full"
        placeholder="e.g. Marvel, Comfort shows"
      />
    </ModalShell>
  )
}
