import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { relativeTime } from '../../../shared/utils/relativeTime'
import { KIND_BADGE, KIND_LABEL } from './memoryMeta'
import type { AiMemory } from '../../ai/api/memoryApi'

interface Props {
  memory: AiMemory
  onEdit: () => void
  onDelete: () => void
}

const SOURCE_LABEL: Record<AiMemory['source'], string> = {
  user: 'You added this',
  ai:   'AI saved this',
  auto: 'Saved automatically',
}

// Mobile: one 44px ⋯ menu (same pattern as ToDoItem.tsx / ItemRow.tsx) instead
// of side-by-side icon buttons that don't fit a touch target on a 393px row.
// Desktop keeps hover-revealed icon buttons — the always-visible ⋯ menu is the
// mandatory mobile fallback for those hover-only actions.
export function MemoryRow({ memory, onEdit, onDelete }: Props) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="relative flex items-start gap-2.5 px-3 py-2.5 min-h-[44px] rounded-xl border border-ink-100 bg-cream-50 transition-colors duration-150"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${KIND_BADGE[memory.kind]}`}>
            {KIND_LABEL[memory.kind]}
          </span>
          <span className="text-sm font-medium text-ink-900 truncate">{memory.title}</span>
        </div>
        <p className="text-xs text-ink-600 line-clamp-2">{memory.content}</p>
        <p className="text-[10px] text-ink-400">
          {SOURCE_LABEL[memory.source]} · {relativeTime(memory.updated_at)}
        </p>
      </div>

      {/* Mobile ⋯ menu — always reachable, no hover needed */}
      <Menu as="div" className="flex-shrink-0 lg:hidden">
        <MenuButton
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 active:text-ink-700 text-lg leading-none rounded press-feedback"
          title="More actions"
          aria-label="More actions"
        >
          ⋯
        </MenuButton>
        <MenuItems
          anchor="bottom end"
          transition
          className="z-[60] w-40 bg-cream-50 border border-ink-200 rounded-xl shadow-card-hover overflow-hidden [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0 data-[closed]:scale-95"
        >
          <MenuItem>
            <button onClick={onEdit} className="w-full text-left px-3 min-h-[44px] text-sm text-ink-700 data-[focus]:bg-ink-100">
              ✎ Edit
            </button>
          </MenuItem>
          <MenuItem>
            <button onClick={onDelete} className="w-full text-left px-3 min-h-[44px] text-sm text-red-600 data-[focus]:bg-ink-100">
              🗑 Delete
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>

      {/* Desktop hover-revealed actions */}
      {hovered && (
        <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            title="Edit"
            className="w-6 h-6 flex items-center justify-center text-ink-300 hover:text-accent-500 transition-colors duration-150 text-xs"
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="w-6 h-6 flex items-center justify-center text-ink-300 hover:text-red-400 transition-colors duration-150 text-xs"
          >
            🗑
          </button>
        </div>
      )}
    </div>
  )
}
