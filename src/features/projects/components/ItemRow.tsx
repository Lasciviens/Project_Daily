import { useState } from 'react'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import { AlignLeft, CalendarPlus, Check, Minus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { ToneDot, TonePill } from '../../../shared/ui'
import { haptic } from '../../../shared/utils/haptics'
import { ITEM_PRIORITY_TONE, ITEM_TYPE_LABEL, ITEM_TYPE_ORDER, ITEM_TYPE_TONE } from '../projectTones'
import type { ProjectItem, ItemPriority, ItemStatus } from '../types'

const PRI_ORDER: ItemPriority[]  = ['low', 'medium', 'high']
const STATUS_ORDER: ItemStatus[] = ['open', 'in_progress', 'done']

interface Props {
  item:       ProjectItem
  onUpdate:   (patch: Partial<Pick<ProjectItem, 'title' | 'notes' | 'type' | 'status' | 'priority'>>) => void
  onDelete:   () => void
  onEdit:     () => void
  isPending?: boolean
}

export function ItemRow({ item, onUpdate, onDelete, onEdit, isPending }: Props) {
  const [showNotes, setShowNotes] = useState(() => !!item.notes)
  const modal = useEntityModal()

  const isDone       = item.status === 'done'
  const isInProgress = item.status === 'in_progress'
  const hasNotes     = !!item.notes

  const cycle = <T,>(order: T[], v: T) => order[(order.indexOf(v) + 1) % order.length]

  function plan() {
    haptic('light')
    modal.open({
      kind: 'time-block',
      config: { heading: 'Plan item' },
      defaults: { title: item.title, category: 'projects', domain: 'work', priority: item.priority, alsoCreateTask: true },
      source: { sourceType: 'project_item', sourceId: item.id, taskSourceType: 'project_item' },
    })
  }

  return (
    <div className={`group/row transition-opacity ${isPending ? 'pointer-events-none opacity-50' : ''}`}>
      <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 px-2 py-1 lg:flex-nowrap">
        {/* 3-state status box: open → in progress → done. */}
        <button
          type="button"
          onClick={() => { haptic('light'); onUpdate({ status: STATUS_ORDER.includes(item.status) ? cycle(STATUS_ORDER, item.status) : 'open' }) }}
          aria-label={`Status: ${item.status.replace('_', ' ')} — tap to advance`}
          title="Tap to advance status"
          className="icon-btn shrink-0"
        >
          <span
            aria-hidden
            className={`grid h-4 w-4 place-items-center rounded border transition-colors ${
              isDone ? 'border-success bg-success text-white'
                : isInProgress ? 'border-accent-500 bg-accent-50 text-accent-600'
                : 'border-line-strong'
            }`}
          >
            {isDone && <Check className="h-3 w-3" strokeWidth={3} />}
            {isInProgress && <Minus className="h-3 w-3" strokeWidth={3} />}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { haptic('light'); onUpdate({ type: cycle(ITEM_TYPE_ORDER, item.type) }) }}
          title="Tap to change type"
          aria-label={`Type: ${ITEM_TYPE_LABEL[item.type]} — tap to change`}
          className="flex shrink-0 items-center justify-center [@media(pointer:coarse)]:min-h-[44px]"
        >
          <TonePill tone={ITEM_TYPE_TONE[item.type]}>{ITEM_TYPE_LABEL[item.type]}</TonePill>
        </button>

        <button
          type="button"
          onClick={() => onUpdate({ priority: cycle(PRI_ORDER, item.priority) })}
          title={`Priority: ${item.priority} — tap to change`}
          aria-label={`Priority: ${item.priority} — tap to change`}
          className="flex shrink-0 items-center justify-center px-1 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
        >
          <ToneDot tone={ITEM_PRIORITY_TONE[item.priority]} />
        </button>

        {/* The title opens the full editor. On phones it takes its own line. */}
        <button
          type="button"
          onClick={onEdit}
          title="Edit item"
          className={`order-first min-w-0 basis-full rounded-md px-1 text-left text-body leading-snug line-clamp-2 transition-colors hover:bg-surface-hover lg:order-none lg:basis-auto lg:flex-1 lg:truncate lg:line-clamp-none ${
            isDone ? 'text-fg-faint line-through' : 'text-fg'
          }`}
        >
          {item.title}
        </button>

        {/* Phones: one menu. Desktop: the same actions appear on row hover / focus. */}
        <Menu as="div" className="ml-auto shrink-0 lg:hidden">
          <MenuButton className="icon-btn" aria-label="More actions" title="More actions">
            <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </MenuButton>
          <MenuItems anchor="bottom end" transition
            className="menu w-44 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
            {!isDone && (
              <MenuItem>
                <button type="button" onClick={plan} className="menu-item"><CalendarPlus aria-hidden className="h-4 w-4" /> Schedule</button>
              </MenuItem>
            )}
            {hasNotes && (
              <MenuItem>
                <button type="button" onClick={() => setShowNotes(n => !n)} className="menu-item">
                  <AlignLeft aria-hidden className="h-4 w-4" /> {showNotes ? 'Hide notes' : 'Show notes'}
                </button>
              </MenuItem>
            )}
            <MenuItem>
              <button type="button" onClick={() => { haptic('warning'); onDelete() }} className="menu-item is-danger">
                <Trash2 aria-hidden className="h-4 w-4" /> Delete
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>

        <div className="hidden shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(pointer:coarse)]:opacity-100 lg:flex">
          {!isDone && (
            <button type="button" onClick={plan} className="icon-btn h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="Schedule this item" title="Schedule this item">
              <CalendarPlus className="h-4 w-4" aria-hidden />
            </button>
          )}
          {hasNotes && (
            <button type="button" onClick={() => setShowNotes(n => !n)} className="icon-btn h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              aria-label={showNotes ? 'Hide notes' : 'Show notes'} title={showNotes ? 'Hide notes' : 'Show notes'}>
              <AlignLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <button type="button" onClick={onEdit} className="icon-btn h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label="Edit item" title="Edit item">
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={onDelete} className="icon-btn h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 hover:text-danger" aria-label="Delete item" title="Delete item">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {showNotes && hasNotes && (
        <p className="whitespace-pre-wrap px-12 pb-1.5 text-meta text-fg-muted">{item.notes}</p>
      )}
    </div>
  )
}
