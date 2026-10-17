import { useState, type ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowRightLeft, BookmarkPlus, CornerUpLeft, Copy, MoreHorizontal, Pencil, PenLine, Trash2, Ungroup } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { Button, cx } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { choiceClass } from '../../../shared/components/plan-modal/fieldStyles'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import { useCopyDish, useMoveDish, useMoveOutOfDish, useRenameDish, useUngroupDish, type Place } from '../hooks/useMealGroups'
import { useRemoveFoodLogEntries } from '../hooks/useFoodLog'
import { useCreateRecipe, useRecipes } from '../hooks/useRecipes'
import { useIngredientLibrary } from '../hooks/useIngredientLibrary'
import { basketToRecipeInput } from '../foodBasket'
import { dishAutoName, rowToItem } from '../foodDish'
import { splitTitleQty } from '../foodIngredients'
import { SLOT_OPTIONS } from './foodLogUtils'
import type { MealSlot } from '../types'
import type { MealGroupRow } from '../../daily/api/dayNutritionApi'

// A dish's ⋯ (Food point 5): Edit meal · Move to · Copy to · Save as saved
// meal · Rename · Ungroup · Delete meal — and an item's ⋯ inside a dish
// (Edit · Move out of meal). Every move, copy and ungroup says what it did
// with Undo; Delete meal asks, then Undo (the diary's one delete).

const MENU = 'menu w-[min(15rem,calc(100vw-24px))]'
const ICON = 'h-4 w-4 shrink-0 text-fg-muted'

export function DishMenu({ group, date, slot }: { group: MealGroupRow; date: string; slot: MealSlot }) {
  const modal = useEntityModal()
  const ungroup = useUngroupDish()
  const remove = useRemoveFoodLogEntries()
  const create = useCreateRecipe()
  const { data: library = [] } = useIngredientLibrary()
  const { data: recipes = [] } = useRecipes()
  const [sheet, setSheet] = useState<null | 'move' | 'copy' | 'rename'>(null)
  const name = group.title
  const ids = group.items.map(m => m.id)

  function saveAsMeal() {
    const libById = new Map(library.map(l => [l.id, l]))
    const recById = new Map(recipes.map(r => [r.id, r]))
    const items = group.items.map(m => rowToItem({
      id: m.id, title: splitTitleQty(m.title).name,
      library_ingredient_id: m.logEntry?.library_ingredient_id ?? null, recipe_id: m.logEntry?.recipe_id ?? null,
      quantity: m.logEntry?.quantity ?? null, unit: m.logEntry?.unit ?? null,
      calories: m.exact?.calories ?? m.calories, protein_g: m.exact?.protein_g ?? m.protein_g, carbs_g: m.exact?.carbs_g ?? m.carbs_g,
      fat_g: m.exact?.fat_g ?? m.fat_g, fiber_g: m.exact?.fiber_g ?? m.fiber_g, sugar_g: m.exact?.sugar_g ?? m.sugar_g,
    }, libById, recById))
    create.mutate(basketToRecipeInput(items, name, 1, { is_temp: true }))
  }

  const item = (label: string, icon: ReactNode, onClick: () => void, danger = false) => (
    <MenuItem>
      <button type="button" onClick={onClick} className={cx('menu-item', danger && 'is-danger')}>{icon}{label}</button>
    </MenuItem>
  )

  return (
    <>
      <Menu>
        <MenuButton aria-label={`${name}: more`} title="More" className="icon-btn h-9 w-9 text-fg-muted [&_svg]:h-[18px] [&_svg]:w-[18px]">
          <MoreHorizontal aria-hidden />
        </MenuButton>
        <MenuItems anchor={{ to: 'bottom end', gap: 4, padding: 12 }} className={MENU}>
          {item('Edit meal', <Pencil className={ICON} aria-hidden />, () => modal.open({ kind: 'food-log', date, slot, groupId: group.groupId }))}
          {item('Move to…', <ArrowRightLeft className={ICON} aria-hidden />, () => setSheet('move'))}
          {item('Copy to…', <Copy className={ICON} aria-hidden />, () => setSheet('copy'))}
          {item('Save as saved meal', <BookmarkPlus className={ICON} aria-hidden />, saveAsMeal)}
          {item('Rename', <PenLine className={ICON} aria-hidden />, () => setSheet('rename'))}
          {item('Ungroup', <Ungroup className={ICON} aria-hidden />, () => ungroup.mutate({ groupId: group.groupId, name }))}
          <div className="menu-sep" />
          {item('Delete meal', <Trash2 className="h-4 w-4 shrink-0" aria-hidden />,
            () => void remove.run(ids, { title: `Delete “${name}”?`, message: `The whole meal: ${group.items.length} items.`, confirmLabel: 'Delete meal', done: `Removed ${name}` }), true)}
        </MenuItems>
      </Menu>
      {(sheet === 'move' || sheet === 'copy') && (
        <DishPlaceSheet mode={sheet} group={group} from={{ date, slot }} onClose={() => setSheet(null)} />
      )}
      {sheet === 'rename' && <DishRenameSheet group={group} onClose={() => setSheet(null)} />}
    </>
  )
}

/** Move to / Copy to: a meal and a day. */
function DishPlaceSheet({ mode, group, from, onClose }: { mode: 'move' | 'copy'; group: MealGroupRow; from: Place; onClose: () => void }) {
  const move = useMoveDish()
  const copy = useCopyDish()
  const today = todayStr()
  // A move starts where the dish is; a copy starts on today (a dish from another day), else the same day.
  const [to, setTo] = useState<Place>({ slot: from.slot, date: mode === 'copy' ? today : from.date })
  const same = mode === 'move' && to.slot === from.slot && to.date === from.date
  const busy = move.isPending || copy.isPending
  const days = [{ label: 'Yesterday', date: shiftDateStr(today, -1) }, { label: 'Today', date: today }, { label: 'Tomorrow', date: shiftDateStr(today, 1) }]

  async function submit() {
    const v = { groupId: group.groupId, to, name: group.title, fromDate: from.date }
    try {
      if (mode === 'move') await move.mutateAsync(v)
      else await copy.mutateAsync(v)
      onClose()
    } catch { /* the hook toasted it */ }
  }

  return (
    <ModalShell compact size="sm" onClose={onClose} dismissible={!busy}
      title={`${mode === 'move' ? 'Move' : 'Copy'} ${group.title}`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => { void submit() }} loading={busy} disabled={same}>{mode === 'move' ? 'Move' : 'Copy'}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meal">
          {SLOT_OPTIONS.map(o => (
            <button key={o.id} type="button" aria-pressed={to.slot === o.id} onClick={() => setTo(t => ({ ...t, slot: o.id }))}
              className={choiceClass(to.slot === o.id, undefined, 'sm')}>
              <span aria-hidden>{o.icon}</span>{o.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Day">
          {days.map(d => (
            <button key={d.label} type="button" aria-pressed={to.date === d.date} onClick={() => setTo(t => ({ ...t, date: d.date }))}
              className={choiceClass(to.date === d.date, undefined, 'sm')}>{d.label}</button>
          ))}
          <DateInput value={to.date} onChange={v => { if (v) setTo(t => ({ ...t, date: v })) }} aria-label="Day"
            className="input input-sm w-[8.5rem] tabular-nums" />
        </div>
      </div>
    </ModalShell>
  )
}

/** Rename: its own name, or empty for the automatic one ("Rice + Chicken"). */
function DishRenameSheet({ group, onClose }: { group: MealGroupRow; onClose: () => void }) {
  const rename = useRenameDish()
  const auto = dishAutoName(group.items.map(m => splitTitleQty(m.title).name))
  const [title, setTitle] = useState(group.ownTitle ?? '')
  const unchanged = (title.trim() || null) === (group.ownTitle?.trim() || null)

  async function submit() {
    if (unchanged) { onClose(); return }
    try {
      await rename.mutateAsync({ groupId: group.groupId, title: title.trim() || null, shown: auto })
      onClose()
    } catch { /* the hook toasted it */ }
  }

  return (
    <ModalShell compact size="sm" onClose={onClose} dismissible={!rename.isPending} title="Rename meal"
      footer={
        <div className="flex items-center justify-end gap-2">
          {group.ownTitle && <Button size="sm" variant="ghost" className="mr-auto" onClick={() => setTitle('')}>Use “{auto}”</Button>}
          <Button size="sm" variant="ghost" onClick={onClose} disabled={rename.isPending}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={() => { void submit() }} loading={rename.isPending}>Save</Button>
        </div>
      }
    >
      <form onSubmit={e => { e.preventDefault(); void submit() }}>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder={auto} aria-label="Meal name" autoFocus
          className="input w-full" />
        <p className="mt-1.5 text-meta text-fg-muted">Empty: named after what is in it.</p>
      </form>
    </ModalShell>
  )
}

/** An item's ⋯ inside a dish: Edit (its own popup) · Move out of meal. */
export function DishItemMenu({ entryId, item, dish, date }: { entryId: string; item: string; dish: string; date: string }) {
  const modal = useEntityModal()
  const moveOut = useMoveOutOfDish()
  return (
    <Menu>
      <MenuButton aria-label={`${item}: more`} title="More" className="icon-btn h-11 w-11 text-fg-muted [&_svg]:h-[18px] [&_svg]:w-[18px]">
        <MoreHorizontal aria-hidden />
      </MenuButton>
      <MenuItems anchor={{ to: 'bottom end', gap: 4, padding: 12 }} className={MENU}>
        <MenuItem>
          <button type="button" className="menu-item" onClick={() => modal.open({ kind: 'food-log-edit', entryId, date })}>
            <Pencil className={ICON} aria-hidden />Edit
          </button>
        </MenuItem>
        <MenuItem>
          <button type="button" className="menu-item" onClick={() => moveOut.mutate({ entryId, item, dish })}>
            <CornerUpLeft className={ICON} aria-hidden />Move out of meal
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}
