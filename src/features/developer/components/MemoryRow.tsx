import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { IconButton, TonePill, cx } from '../../../shared/ui'
import { relativeTime } from '../../../shared/utils/relativeTime'
import { KIND_LABEL, KIND_TONE, SOURCE_LABEL } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

interface Props {
  memory: AiMemory
  onEdit: () => void
  onDelete: () => void
  /** Pane mode (wider pages): the whole row picks the memory for the editor beside the list. */
  onSelect?: () => void
  selected?: boolean
}

function Body({ memory }: { memory: AiMemory }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        <TonePill tone={KIND_TONE[memory.kind]}>{KIND_LABEL[memory.kind]}</TonePill>
        <span className="truncate text-body font-semibold text-fg">{memory.title}</span>
      </span>
      <span className="line-clamp-2 text-body text-fg-2">{memory.content}</span>
      <span className="text-meta text-fg-muted">
        {SOURCE_LABEL[memory.source]} · {relativeTime(memory.updated_at)}
      </span>
    </>
  )
}

// Touch: one 44px overflow menu. Mouse: hover-revealed icon buttons, with the
// menu as the always-reachable fallback below lg. Pane mode has neither: the
// editor beside the list holds Save and Delete.
export function MemoryRow({ memory, onEdit, onDelete, onSelect, selected = false }: Props) {
  if (onSelect) {
    return (
      <li>
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
          className={cx(
            'flex min-h-[44px] w-full flex-col gap-1 py-3 pl-4 pr-3 text-left transition-colors',
            selected ? 'bg-accent-50' : '[@media(hover:hover)]:hover:bg-surface-hover',
          )}
        >
          <Body memory={memory} />
        </button>
      </li>
    )
  }
  return (
    <li className="group flex min-h-[44px] items-start gap-2.5 py-3 pl-4 pr-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Body memory={memory} />
      </div>

      <Menu as="div" className="shrink-0 lg:hidden">
        <MenuButton as={IconButton} label="More actions"><MoreHorizontal /></MenuButton>
        <MenuItems anchor="bottom end" transition className="menu w-40 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
          <MenuItem>
            <button type="button" onClick={onEdit} className="menu-item"><Pencil aria-hidden className="h-4 w-4" /> Edit</button>
          </MenuItem>
          <MenuItem>
            <button type="button" onClick={onDelete} className="menu-item is-danger"><Trash2 aria-hidden className="h-4 w-4" /> Delete</button>
          </MenuItem>
        </MenuItems>
      </Menu>

      <div className="hidden shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 lg:flex">
        <IconButton label="Edit memory" onClick={onEdit}><Pencil /></IconButton>
        <IconButton label="Delete memory" onClick={onDelete} className="hover:!text-danger"><Trash2 /></IconButton>
      </div>
    </li>
  )
}
