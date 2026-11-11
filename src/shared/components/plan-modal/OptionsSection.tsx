// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's Calendar row (owner's point 5) and a Google Task's list.
//  The row names where the item goes — "Apple Calendar · busy", "Google
//  Tasks", "Not on Google" (never "Auto": sheetRules) — with Apple's or
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
import { ChoiceRow, NoteRow, Panel, Row, TapRow } from './ItemRows'
import type { PanelKey } from './TimeSection'
import { fieldGoes, type FieldGoes } from './itemScreenRules'

const goesOf = (target: GoogleTarget, app: CalendarApp, dated: boolean): FieldGoes => fieldGoes('calendar', { target, calendarApp: app, dated })

export function CalendarRow({ shape, target, app, dated, refused, open, toggle, onPick }: {
  shape: Pick<ItemInput, 'time' | 'durationMinutes' | 'repeat'>
  target: GoogleTarget
  app: CalendarApp
  dated: boolean
  /** Why Apple doesn't have it yet (appleRefused), or null. */
  refused: string | null
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
  onPick: (target: GoogleTarget) => void
}) {
  const warning = googleTargetProblem({ repeat: shape.repeat, google: target }, app)
  return (
    <>
      <TapRow label="Calendar" open={open === 'calendar'} onClick={() => toggle('calendar')} tone={refused ? 'danger' : undefined}
        value={<><Truncate className="min-w-0">{googleTargetLabel(shape, target, app)}</Truncate><FieldMark always goes={goesOf(target, app, dated)} refused={refused} /></>} />
      {refused && <NoteRow tone="danger">{refused}</NoteRow>}
      {warning?.level === 'warning' && <NoteRow tone="warn">{warning.message}</NoteRow>}
      {open === 'calendar' && (
        <Panel label="Where it goes">
          {googleChoices(shape, app).map(c => (
            <ChoiceRow key={c.target} label={c.label} hint={c.disabled ?? c.hint} chosen={c.target === target} disabled={!!c.disabled}
              icon={<span className="inline-flex h-4 w-4 shrink-0"><MarkIcon goes={goesOf(c.target, app, dated)} /></span>}
              onClick={() => { onPick(c.target); toggle(null) }} />
          ))}
          <p className="pt-1.5 text-meta text-fg-muted">Which calendar each area uses is set in Settings → Calendar.</p>
        </Panel>
      )}
    </>
  )
}

/**
 * The Google Tasks list a Google Task goes to (owner, 31.10.2026: a dropdown of the lists, not a "+" row): the task's
 * own list as the row's value; opened, the lists and "New list…", which turns the row into a field for a name (made
 * on Google when the item is saved). A name not on Google yet says "new".
 */
export function GoogleListRow({ value, typing, onPick, onNew, onType, onDone, open, toggle, mark }: {
  value: string
  /** "New list…" was picked: the row is a field. */
  typing: boolean
  onPick: (title: string) => void
  onNew: () => void
  onType: (title: string) => void
  /** The name is done (Enter, or the field left): only then is it saved — and looked up or made on Google. */
  onDone: () => void
  open: PanelKey | null
  toggle: (k: PanelKey | null) => void
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
        <input autoFocus value={value} onChange={e => onType(e.target.value)} placeholder="Its name" maxLength={100}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onDone() } }} onBlur={onDone} enterKeyHint="done"
          aria-label="New Google Tasks list" className="input-bare w-40 min-w-0 pb-0 text-right text-lead" />
      </Row>
    )
  }
  return (
    <>
      <TapRow label="List" mark={mark} open={open === 'list'} onClick={() => toggle('list')} value={name ? `${name}${isNew ? ' · new' : ''}` : 'Pick one'} />
      {open === 'list' && (
        <Panel label="Google Tasks list">
          {lists.map(l => (
            <ChoiceRow key={l.id} label={l.title} chosen={l.title.toLowerCase() === name.toLowerCase()} onClick={() => { onPick(l.title); toggle(null) }} />
          ))}
          {lists.length === 0 && <p className="py-1.5 text-meta text-fg-muted">Your Google lists show here once Google Tasks has synced.</p>}
          <ChoiceRow label="New list…" chosen={false} onClick={() => { onNew(); toggle(null) }} />
        </Panel>
      )}
    </>
  )
}
