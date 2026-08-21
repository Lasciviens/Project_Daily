import { useState } from 'react'
import { Sheet } from '../../../shared/components/Sheet'
import {
  useGoogleTaskLists, useCreateGoogleTaskList, useRenameGoogleTaskList, useDeleteGoogleTaskList,
  type GoogleTaskListRow,
} from '../hooks/useGoogleTaskLists'

interface Props {
  open:    boolean
  onClose: () => void
}

function ListRow({ list }: { list: GoogleTaskListRow }) {
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

  return (
    <div className="flex items-center gap-2 min-h-[44px] px-3 rounded-lg border border-ink-100 bg-cream-50">
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setTitle(list.title); setEditing(false) } }}
          className="flex-1 min-h-[36px] px-2 rounded-md border border-ink-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-300"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-1 text-left text-sm text-ink-800 truncate press-feedback"
          title="Tap to rename"
        >
          {list.title}
        </button>
      )}
      {list.is_default && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-50 text-accent-600 flex-shrink-0">Default</span>
      )}
      {!list.is_default && (
        <button
          type="button"
          onClick={() => { if (confirm(`Delete "${list.title}"? Tasks in it will stay locally, un-synced from Google.`)) remove.mutate({ localId: list.id, googleId: list.google_id }) }}
          disabled={remove.isPending}
          className="w-8 h-8 flex-shrink-0 flex items-center justify-center text-ink-300 hover:text-red-500 transition-colors duration-150 text-sm"
          title="Delete list"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// Multi-list management — Phase 2's remaining slice (Phase 1's data model
// already carries google_tasklist_id; this is the UI layer). Deliberately
// kept OUTSIDE UnifiedPlanModal (same reasoning that put "Set parent" in its
// own SetParentTaskSheet rather than the modal's taskExtra slot — taskExtra
// is a plain ReactNode with no access to the modal's own form/patch state,
// per CLAUDE.md's start_date precedent). Google Tasks lists have no delete
// confirmation of their own beyond the browser confirm() above — a real
// modal felt like overkill for a rare, already-named action.
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
      <div className="p-4 flex flex-col gap-2">
        {isLoading && <p className="text-sm text-ink-400">Loading…</p>}
        {!isLoading && lists.length === 0 && (
          <p className="text-sm text-ink-400">
            No lists synced yet — tap Import in Settings to pull your Google Task lists.
          </p>
        )}
        {lists.map(l => <ListRow key={l.id} list={l} />)}

        <div className="flex items-center gap-2 mt-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addList() }}
            placeholder="New list name…"
            className="flex-1 min-h-[44px] px-3 rounded-lg border border-ink-200 bg-cream-50 text-sm focus:outline-none focus:ring-2 focus:ring-accent-300"
          />
          <button
            type="button"
            onClick={addList}
            disabled={create.isPending || !newTitle.trim()}
            className="min-h-[44px] px-4 rounded-lg bg-accent-500 text-white text-sm font-semibold press-feedback disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </Sheet>
  )
}
