import { useState } from 'react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, SegmentedControl } from '../../../shared/ui'
import { useCreateTraktList } from '../trakt/useTraktExtras'
import type { ListItemRef } from '../trakt/traktApi'
import type { FollowKind } from '../api/followsApi'
import { AutoListPicker } from './AutoListPicker'

type Mode = 'manual' | 'auto'

/**
 * New list. Every list is a list: you either add titles yourself (a private
 * Trakt list) or let it fill itself from a franchise, studio, keyword or person
 * on TMDB. `auto` offers the second way (the Lists page; not "Add to list",
 * which is about the title in hand); without Trakt only that way is possible.
 */
export function NewListDialog({ items, onClose, auto = false, traktConnected = true, onAutoCreated }: {
  items?: ListItemRef[]
  onClose: () => void
  auto?: boolean
  traktConnected?: boolean
  onAutoCreated?: (kind: FollowKind, tmdbId: number) => void
}) {
  const [mode, setMode] = useState<Mode>(auto && !traktConnected ? 'auto' : 'manual')
  const [name, setName] = useState('')
  const create = useCreateTraktList()
  const submit = async () => {
    if (!name.trim()) return
    try { await create.mutateAsync({ name: name.trim(), items }); onClose() } catch { /* toasted */ }
  }
  const manual = mode === 'manual'
  return (
    <ModalShell
      onClose={onClose}
      size={manual ? 'xs' : 'sm'}
      layer="confirm"
      title="New list"
      subtitle={manual ? 'A private list on your Trakt account — you add the titles.' : 'Fills itself with every film from one source on TMDB, new ones included.'}
      footer={manual ? <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { void submit() }} loading={create.isPending} disabled={!name.trim()}>Create</Button>
      </div> : undefined}
    >
      <div className="flex flex-col gap-3">
        {auto && traktConnected && (
          <SegmentedControl<Mode> value={mode} onChange={setMode}
            options={[{ value: 'manual', label: 'I add titles' }, { value: 'auto', label: 'Fill automatically' }]} />
        )}
        {manual ? (
          <div>
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
          </div>
        ) : (
          <AutoListPicker onCreated={(k, id) => { onAutoCreated?.(k, id); onClose() }} />
        )}
      </div>
    </ModalShell>
  )
}
