// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's Calendar row (owner's point 5) and a Google Task's list.
//  The row names where the item goes — "Apple Calendar · busy", "Google
//  Tasks", "Only in this app" (never "Auto": sheetRules) — with Apple's or
//  Google's mark (the app's own when it stays here), always shown; the mark
//  gets a red dot only when Apple refused the item. Tapped, it lists the four
//  choices with what each does, a blocked one with its reason.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { useGoogleTaskLists } from '../../../features/todo/hooks/useGoogleTaskLists'
import { Truncate } from '../../ui'
import { googleChoices, googleTargetLabel, googleTargetProblem, type CalendarApp } from '../../../features/items/sheetRules'
import type { GoogleTarget, ItemInput } from '../../../features/items/itemTypes'
import { FieldMark, MarkIcon } from './FieldMark'
import { NoteRow, Row, SelectRow } from './ItemRows'
import { fieldGoes, type FieldGoes } from './itemScreenRules'
import { typingHints } from './fieldStyles'

/** New list…'s place in the list (no Google list has this title: it isn't one a person types). */
const NEW_LIST = '\u0000new'

const goesOf = (target: GoogleTarget, app: CalendarApp, dated: boolean): FieldGoes => fieldGoes('calendar', { target, calendarApp: app, dated })

export function CalendarRow({ shape, target, app, dated, refused, onPick }: {
  shape: Pick<ItemInput, 'time' | 'durationMinutes' | 'repeat'>
  target: GoogleTarget
  app: CalendarApp
  dated: boolean
  /** Why Apple doesn't have it yet (appleRefused), or null. */
  refused: string | null
  onPick: (target: GoogleTarget) => void
}) {
  const warning = googleTargetProblem({ repeat: shape.repeat, google: target }, app)
  const options = googleChoices(shape, app).map(c => ({
    value: c.target, label: c.label, hint: c.disabled ?? c.hint, disabled: !!c.disabled,
    icon: <span className="inline-flex h-4 w-4 shrink-0"><MarkIcon goes={goesOf(c.target, app, dated)} /></span>,
  }))
  return (
    <>
      <SelectRow<GoogleTarget> label="Calendar" value={target} options={options} onChange={onPick} tone={refused ? 'danger' : undefined}
        footer="Each area's calendar is turned on or off in Settings → Calendar."
        shown={<><Truncate className="min-w-0">{googleTargetLabel(shape, target, app)}</Truncate><FieldMark always goes={goesOf(target, app, dated)} refused={refused} /></>} />
      {refused && <NoteRow tone="danger">{refused}</NoteRow>}
      {warning?.level === 'warning' && <NoteRow tone="warn">{warning.message}</NoteRow>}
    </>
  )
}

/**
 * The Google Tasks list a Google Task goes to (owner, 31.10.2026: a dropdown of the lists, not a "+" row): the task's
 * own list as the row's value; opened, the lists and "New list…", which turns the row into a field for a name (made
 * on Google when the item is saved). A name not on Google yet says "new".
 */
export function GoogleListRow({ value, typing, onPick, onNew, onType, onDone, openOnMount, mark }: {
  value: string
  /** "New list…" was picked: the row is a field. */
  typing: boolean
  onPick: (title: string) => void
  onNew: () => void
  onType: (title: string) => void
  /** The name is done (Enter, or the field left): only then is it saved — and looked up or made on Google. */
  onDone: () => void
  /** Opened as the screen shows (a menu's "Move to list…"). */
  openOnMount?: boolean
  mark?: ReactNode
}) {
  const listsQ = useGoogleTaskLists()
  const lists = listsQ.data ?? []
  const name = value.trim()
  const known = (t: string) => lists.some(l => l.title.toLowerCase() === t.toLowerCase())
  // "new" only once the lists are there to compare with (before that every name would read as new).
  const isNew = !!name && listsQ.isSuccess && lists.length > 0 && !known(name)
  if (typing) {
    return (
      <Row label="New list" mark={mark}>
        <input autoFocus value={value} onChange={e => onType(e.target.value)} placeholder="Title" maxLength={100} {...typingHints('list')}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onDone() } }} onBlur={onDone}
          aria-label="New Google Tasks list" className="input-bare w-40 min-w-0 pb-0 text-right text-lead" />
      </Row>
    )
  }
  // The lists, and New list… last (a field for the name in the row).
  const options = [
    ...lists.map(l => ({ value: l.title, label: l.title })),
    ...(name && !lists.some(l => l.title.toLowerCase() === name.toLowerCase()) ? [{ value: name, label: name, hint: isNew ? 'New — made on Google when saved' : undefined }] : []),
    { value: NEW_LIST, label: 'New list…' },
  ]
  const chosen = lists.find(l => l.title.toLowerCase() === name.toLowerCase())?.title ?? name
  return (
    <SelectRow label="List" mark={mark} value={chosen} options={options} openOnMount={openOnMount}
      shown={<Truncate className="min-w-0">{name ? `${name}${isNew ? ' · new' : ''}` : 'Pick one'}</Truncate>}
      footer={lists.length === 0 ? 'Your Google lists show here once Google Tasks has synced.' : undefined}
      onChange={v => (v === NEW_LIST ? onNew() : onPick(v))} />
  )
}
