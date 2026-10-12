import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { MoreHorizontal } from 'lucide-react'
import { Button, IconButton, Truncate, cx } from '../../../../shared/ui'
import { useSessionActionItems, type ExtraAction, type SessionActionItem } from '../../hooks/useSessionActionItems'
import type { SessionStatus } from '../../plan/sessionState'
import type { TrainingPlanRef } from '../../api/trainingPlanApi'

export type { ExtraAction, SessionActionItem }

/** ⋯ with the given entries (also used for the workout view's own list). */
export function SessionMenu({ items, label = 'Session actions' }: { items: readonly SessionActionItem[]; label?: string }) {
  if (items.length === 0) return null
  const firstDanger = items.findIndex(i => i.danger)
  return (
    <Menu as="div" className="shrink-0" onClick={e => e.stopPropagation()}>
      <MenuButton as={IconButton} label={label}><MoreHorizontal /></MenuButton>
      <MenuItems anchor="bottom end" transition className="menu w-60 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        {items.map((i, n) => (
          <div key={i.key} className="contents">
            {n === firstDanger && n > 0 && <div className="menu-sep" role="separator" />}
            <MenuItem>
              <button type="button" onClick={i.onSelect} className={cx('menu-item', i.danger && 'is-danger')}>
                <span aria-hidden className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{i.icon}</span>
                <Truncate>{i.label}</Truncate>
              </button>
            </MenuItem>
          </div>
        ))}
      </MenuItems>
    </Menu>
  )
}

/** The popup's buttons for a session: its main actions as buttons. */
export function SessionActionBar({ items }: { items: readonly SessionActionItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i, n) => (
        <Button key={i.key} size="sm" variant={n === 0 ? 'primary' : 'secondary'} icon={i.icon} onClick={i.onSelect}>
          {i.label}
        </Button>
      ))}
    </div>
  )
}

/** Every action of a session behind one ⋯ (task rows, agenda rows, Next). */
export function TrainingPlanMenu(props: { plan: TrainingPlanRef; status: SessionStatus; weekly?: { templateId: string } | null; skipId?: string | null; onGone?: () => void; extra?: readonly ExtraAction[]; label?: string }) {
  const { primary, more } = useSessionActionItems(props)
  const extra = (props.extra ?? []).map((e, n) => ({ ...e, key: `extra-${n}` }))
  return <SessionMenu items={[...primary, ...extra, ...more]} label={props.label} />
}
