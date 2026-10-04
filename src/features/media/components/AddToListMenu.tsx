import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ListPlus, Plus } from 'lucide-react'
import { useTraktStatus } from '../trakt/useTrakt'
import { useChangeTraktList, useTraktLists } from '../trakt/useTraktExtras'
import { NewListDialog } from './NewListDialog'

/** "Add to list" for one title — your Trakt personal lists, plus a new one. Hidden without Trakt. */
export function AddToListMenu({ type, tmdb, title }: { type: 'movie' | 'show'; tmdb: number; title: string }) {
  const { data: trakt } = useTraktStatus()
  const [open, setOpen] = useState(false)
  const lists = useTraktLists(open)
  const change = useChangeTraktList()
  const [naming, setNaming] = useState(false)
  if (!trakt?.connected) return null
  const item = { type, tmdb }

  return (
    <>
    {naming && <NewListDialog items={[item]} onClose={() => setNaming(false)} />}
    <Menu>
      <MenuButton className="btn-ghost btn-sm" aria-label="Add to list" onClick={() => setOpen(true)}>
        <ListPlus aria-hidden className="h-4 w-4" /> <span className="sm:hidden">List</span><span className="hidden sm:inline">Add to list</span>
      </MenuButton>
      <MenuItems
        anchor={{ to: 'bottom start', gap: 6, padding: 12 }}
        transition
        className="menu z-[70] w-[min(16rem,calc(100vw-24px))] transition duration-150 ease-out data-[closed]:opacity-0"
      >
        {lists.isLoading && <p className="px-2.5 py-2 text-meta text-fg-muted">Loading lists…</p>}
        {lists.error && <p className="px-2.5 py-2 text-meta text-danger">{(lists.error as Error).message}</p>}
        {(lists.data ?? []).map(l => (
          <MenuItem key={l.id}>
            <button type="button" className="menu-item w-full" onClick={() => change.mutate({ listId: l.id, items: [item] })}>
              <span className="min-w-0 flex-1 truncate text-left">{l.name}</span>
              <span className="text-micro tabular-nums text-fg-faint">{l.itemCount}</span>
            </button>
          </MenuItem>
        ))}
        {lists.data?.length === 0 && <p className="px-2.5 py-2 text-meta text-fg-muted">No lists yet.</p>}
        <div className="menu-sep" />
        <MenuItem>
          <button
            type="button"
            className="menu-item w-full"
            onClick={() => setNaming(true)}
          >
            <Plus aria-hidden className="h-4 w-4" /> New list with “{title}”
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
    </>
  )
}
