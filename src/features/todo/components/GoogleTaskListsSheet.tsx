import { useState } from 'react'
import { X } from 'lucide-react'
import { Sheet } from '../../../shared/components/Sheet'
import { useEntityModal } from '../../../shared/modals'
import { Button, IconButton, TonePill } from '../../../shared/ui'
import {
  useGoogleTaskLists, useCreateGoogleTaskList, useRenameGoogleTaskList, useDeleteGoogleTaskList,
  type GoogleTaskListRow,
} from '../hooks/useGoogleTaskLists'

interface Props {
  open:    boolean
  onClose: () => void
}

function ListRow({ list }: { list: GoogleTaskListRow }) {
  const modal = useEntityModal()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(list.title)
  const rename = useRenameGoogleTaskList()
  const remove = useDeleteGoogleTaskList()

  function save() {
    const trimmed = title.trim()
    if (trimmed && trimmed !== list.title) {
      rename.mutate({ localId: list.id, googleId: list.google_id, title: trimmed })
    }
    setEditing(false)
  }

  async function confirmDelete() {
    const ok = await modal.confirm({
      title: `Delete "${list.title}"?`,
      message: 'Tasks in it stay here, un-synced from Google.',
      confirmLabel: 'Delete list',
      destructive: true,
    })
    if (ok) remove.mutate({ localId: list.id, googleId: list.google_id })
  }

  return (
    <div className="row border border-line bg-surface pr-1">
      {editing ? (
        <input
          autoFocus
          aria-label="List name"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setTitle(list.title); setEditing(false) } }}
          className="input flex-1"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-[44px] flex-1 truncate text-left text-body text-fg press-feedback"
          title="Tap to rename"
        >
          {list.title}
        </button>
      )}
      {list.is_default && <TonePill tone="accent" className="shrink-0">Default</TonePill>}
      {!list.is_default && (
        <IconButton label="Delete list" onClick={() => { void confirmDelete() }} disabled={remove.isPending} className="text-fg-faint hover:text-danger">
          <X aria-hidden />
        </IconButton>
      )}
    </div>
  )
}

// Multi-list management — Phase 2's remaining slice (Phase 1's data model
// already carries google_tasklist_id; this is the UI layer). Deliberately
// kept OUTSIDE UnifiedPlanModal (same reasoning that put "Set parent" in its
// own SetParentTaskSheet rather than the modal's taskExtra slot — taskExtra
// is a plain ReactNode with no access to the modal's own form/patch state,
// per CLAUDE.md's start_date precedent).
export function GoogleTaskListsSheet({ open, onClose }: Props) {
  const { data: lists = [], isLoading } = useGoogleTaskLists()
  const create = useCreateGoogleTaskList()
  const [newTitle, setNewTitle] = useState('')

  function addList() {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    create.mutate(trimmed, { onSuccess: () => setNewTitle('') })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Google Task lists" size="sm">
      <div className="flex flex-col gap-2 p-4">
        {isLoading && <p className="text-body text-fg-muted">Loading…</p>}
        {!isLoading && lists.length === 0 && (
          <p className="text-body text-fg-muted">
            No lists synced yet — tap Import in Settings to pull your Google Task lists.
          </p>
        )}
        {lists.map(l => <ListRow key={l.id} list={l} />)}

        <div className="mt-2 flex items-center gap-2">
          <input
            value={newTitle}
            aria-label="New list name"
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addList() }}
            placeholder="New list name…"
            className="input flex-1"
          />
          <Button variant="primary" onClick={addList} loading={create.isPending} disabled={!newTitle.trim()}>
            Add list
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
