import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { AlarmClock, ArrowUpRight, Check, ChevronDown, ChevronRight, Eye, MoreHorizontal, Undo2 } from 'lucide-react'
import { MetaLine, Skeleton, Truncate, cx } from '../../../shared/ui'
import { ModalShell } from '../../../shared/modals'
import { formatDate } from '../../../shared/utils/dateFormat'
import { lookLine, SNOOZE_DAYS, type Look, type LookThing, type RecordFact } from '../shopSuggestions'
import { LookIcon } from './lookIcon'
import { wrapLong } from './lookFacts'
import { isShownLink } from '../storeRows'
import { addDays } from '../ownModel'

// "Needs a look": one button in the Shop page's header that opens every row in a
// sheet (owner, 23.11.2026; it was a card in a right rail, and on a phone one line
// above the things). Each row has its one action, and Snooze (a week, or until
// the day before its deadline) · Got it behind ⋯.

const ACTION: Record<Look['action'], string> = { open: 'Open', bought: 'Bought', value: 'Update', list: 'Show', claim: 'Claim' }

export interface LookActions {
  /** Open the thing (an old "Could sell for": at that fact). */
  onOpen: (look: Look) => void
  onBought: (look: Look) => void
  /** Money to claim under a price protection: how, and "Got 500 back". */
  onClaim: (look: Look) => void
  onSnooze: (look: Look) => void
  onGotIt: (look: Look) => void
  onShowAgain: (look: Look) => void
  /** Open one of the things a counting row lists. */
  onOpenThing: (id: string, fact?: RecordFact) => void
}

/** Its state: still loading, a read that failed (one line with Try again — never an answer), or the rows and those put away. */
export interface LookState { looks: readonly Look[]; hidden: readonly Look[]; loading: boolean; failed: boolean; onRetry: () => void; today: string }

/** A failed read: one compact line, never "nothing needs a look". */
function LookFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <span className="text-body text-fg-muted">
      Couldn't load what needs a look.{' '}
      <button type="button" onClick={onRetry} className="font-semibold text-accent-600 hover:underline">Try again</button>
    </span>
  )
}

/**
 * The facts as one "a · b · c" line; where a price was read follows its price
 * as one piece ("2 990 NOK at elkjop.no") that only an overlong address breaks.
 */
function lookFacts(look: Look) {
  if (!look.where || !look.facts.length) return wrapLong(look.facts)
  const last = look.facts[look.facts.length - 1]
  return [...wrapLong(look.facts.slice(0, -1)), <span key="w">{last} <span className="whitespace-normal break-words">{look.where}</span></span>]
}

/** "Snooze a week", or "Snooze until 14.11.2026" when its deadline comes first — none for a row due tomorrow. */
function snoozeLabel(look: Look, today: string): string | null {
  if (!look.snoozeTo) return null
  return look.snoozeTo === addDays(today, SNOOZE_DAYS) ? 'Snooze a week' : `Snooze until ${formatDate(look.snoozeTo)}`
}

/** Snooze · Got it. */
function LookMenu({ look, today, onSnooze, onGotIt }: { look: Look; today: string; onSnooze: () => void; onGotIt: () => void }) {
  const snooze = snoozeLabel(look, today)
  return (
    <Menu as="div" className="shrink-0">
      <MenuButton className="icon-btn h-8 w-8 text-fg-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Snooze or put away: ${look.title}`} title="Snooze or put away">
        <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
      </MenuButton>
      <MenuItems anchor="bottom end" transition
        className="menu w-52 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
        {snooze && <MenuItem><button type="button" onClick={onSnooze} className="menu-item"><AlarmClock aria-hidden className="h-4 w-4" /> {snooze}</button></MenuItem>}
        <MenuItem><button type="button" onClick={onGotIt} className="menu-item"><Check aria-hidden className="h-4 w-4" /> Got it</button></MenuItem>
      </MenuItems>
    </Menu>
  )
}

/** One row: what, what is due and the money involved; its one action, and ⋯. */
function LookRow({ look, today, actions, onList }: { look: Look; today: string; actions: LookActions; onList: (look: Look) => void }) {
  const open = () => (look.action === 'list' ? onList(look) : actions.onOpen(look))
  const act = () => (look.action === 'bought' ? actions.onBought(look) : look.action === 'claim' ? actions.onClaim(look) : open())
  return (
    <li className="flex items-start gap-0.5">
      {/* data-return-focus: Owned's pane hides this list while it is open, so the focus finds this row again by its key. */}
      <button type="button" onClick={open} data-return-focus={`look:${look.key}`} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-row px-2 py-2 text-left transition-colors hover:bg-surface-hover">
        <LookIcon look={look} />
        <span className="min-w-0 flex-1">
          <Truncate as="span" className="block text-body font-medium text-fg">{look.title}</Truncate>
          <MetaLine as="span" className="block text-meta tabular-nums text-fg-muted" items={lookFacts(look)} />
        </span>
      </button>
      {/* The page a price match was read from (Prisjakt's offers): its whole address in the title, opened by the owner. */}
      {look.kind === 'price_match' && look.link && isShownLink(look.link) && (
        <a href={look.link} target="_blank" rel="noopener noreferrer" title={look.link} aria-label={`Open the offers: ${look.title}`}
          className="icon-btn mt-1 h-8 w-8 shrink-0 text-fg-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <ArrowUpRight aria-hidden className="h-4 w-4" />
        </a>
      )}
      <span className="flex shrink-0 items-center pt-1">
        <button type="button" onClick={act} data-return-focus={`look-act:${look.key}`} aria-label={`${ACTION[look.action]}: ${look.title}`}
          className={cx('btn-ghost btn-sm gap-1 px-2', look.action === 'bought' ? 'text-fg-2' : 'text-accent-600')}>
          {look.action === 'bought' && <Check aria-hidden className="h-4 w-4" />}
          {ACTION[look.action]}
        </button>
        <LookMenu look={look} today={today} onSnooze={() => actions.onSnooze(look)} onGotIt={() => actions.onGotIt(look)} />
      </span>
    </li>
  )
}

/** The things a counting row is about (tidy-up, a deal day): each opens its record. */
function ThingsSheet({ look, onClose, onOpenThing }: { look: Look; onClose: () => void; onOpenThing: (id: string, fact?: RecordFact) => void }) {
  return (
    <ModalShell open onClose={onClose} title={look.title} size="sm"
      subtitle={look.kind === 'deal_day' ? look.facts.slice(0, 2).join(' · ') : undefined}>
      <ul className="-mx-2 flex flex-col">
        {look.things.map((t: LookThing) => (
          <li key={t.id}>
            <button type="button" onClick={() => onOpenThing(t.id, t.fact)}
              className="flex min-h-[44px] w-full items-center gap-2 rounded-row px-2 py-1.5 text-left transition-colors hover:bg-surface-hover">
              <span className="min-w-0 flex-1">
                <Truncate as="span" className="block text-body text-fg">{t.title}</Truncate>
                <MetaLine as="span" className="block text-meta tabular-nums text-fg-muted" items={t.facts} />
              </span>
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
            </button>
          </li>
        ))}
      </ul>
    </ModalShell>
  )
}

/** The rows snoozed or put away, each with Show again — folded under one line. */
function HiddenLooks({ hidden, onShowAgain }: { hidden: readonly Look[]; onShowAgain: (look: Look) => void }) {
  const [open, setOpen] = useState(false)
  if (!hidden.length) return null
  return (
    <div className="mt-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex min-h-[36px] items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2">
        <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        {hidden.length} snoozed or put away
      </button>
      {open && (
        <ul className="-mx-2 flex flex-col">
          {hidden.map(l => (
            <li key={l.key} className="flex items-center gap-2 px-2 py-1">
              <Truncate as="span" className="min-w-0 flex-1 text-meta text-fg-muted">{l.title}</Truncate>
              <button type="button" onClick={() => onShowAgain(l)} aria-label={`Show again: ${l.title}`} className="btn-ghost btn-sm shrink-0 gap-1 px-2 text-accent-600">
                <Undo2 aria-hidden className="h-4 w-4" /> Show again
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The rows, every one or the first `limit` and "N more" (in place); a counting row opens its list in a sheet. */
function LookList({ looks, hidden, limit, today, actions }: { looks: readonly Look[]; hidden: readonly Look[]; limit?: number; today: string; actions: LookActions }) {
  const [all, setAll] = useState(false)
  const [listing, setListing] = useState<Look | null>(null)
  const cut = limit != null && looks.length > limit
  const shown = cut && !all ? looks.slice(0, limit) : looks
  return (
    <>
      {looks.length > 0 && <ul className="-mx-2 flex flex-col">{shown.map(l => <LookRow key={l.key} look={l} today={today} actions={actions} onList={setListing} />)}</ul>}
      {cut && (
        <button type="button" aria-expanded={all} onClick={() => setAll(a => !a)}
          className="mt-1 flex min-h-[36px] items-center gap-1 text-meta font-semibold text-accent-600 hover:underline">
          <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', all && 'rotate-180')} />
          {all ? 'Show fewer' : `${looks.length - (limit as number)} more`}
        </button>
      )}
      <HiddenLooks hidden={hidden} onShowAgain={actions.onShowAgain} />
      {listing && <ThingsSheet look={listing} onClose={() => setListing(null)} onOpenThing={actions.onOpenThing} />}
    </>
  )
}

const NOTHING = 'Nothing needs a look right now.'

/**
 * Needs a look's one button in the Shop page's header (owner, 23.11.2026: it left the rail, whose room goes to the
 * things): an icon with the count as a badge laid over its corner — the button never changes size, so the bar never
 * reshapes while the rows load or their number changes (THEME §6.3). A tap opens every row in a sheet.
 */
export function NeedsALookButton({ looks, hidden, loading, failed, onRetry, today, actions }: LookState & { actions: LookActions }) {
  const [open, setOpen] = useState(false)
  const line = lookLine(looks)
  const label = loading ? 'Needs a look' : failed ? 'Needs a look: couldn\'t load' : looks.length ? `Needs a look: ${line.words}${line.claim ? ` · ${line.claim}` : ''}` : 'Needs a look: nothing right now'
  // A row's action closes the sheet first (it opens a record or a sheet of its own); Snooze and Got it keep it open.
  const closing = (fn: (look: Look) => void) => (look: Look) => { setOpen(false); fn(look) }
  const inSheet: LookActions = {
    ...actions,
    onOpen: closing(actions.onOpen),
    onBought: closing(actions.onBought),
    onClaim: closing(actions.onClaim),
    onOpenThing: (id, fact) => { setOpen(false); actions.onOpenThing(id, fact) },
  }
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-label={label} title={label} onClick={() => setOpen(true)}
        className={cx('icon-btn-bordered relative h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11', !loading && !failed && looks.length > 0 && 'text-fg')}>
        <Eye aria-hidden className="h-[18px] w-[18px]" />
        {!loading && !failed && looks.length > 0 && (
          <span aria-hidden className="count-badge absolute -right-1.5 -top-1.5 min-w-[1.25rem] justify-center tabular-nums shadow-card">{looks.length}</span>
        )}
        {!loading && failed && <span aria-hidden data-tone="warn" className="tone-dot absolute -right-0.5 -top-0.5" />}
      </button>
      <ModalShell open={open} onClose={() => setOpen(false)} title="Needs a look"
        subtitle={failed ? undefined : looks.length ? `${looks.length} to look at${line.claim ? ` · ${line.claim}` : ''}` : undefined}>
        {loading
          ? <div aria-busy="true"><LookSkeleton rows={3} /></div>
          : failed
            ? <p className="py-1"><LookFailed onRetry={onRetry} /></p>
            : <>
              {!looks.length && <p className="pb-1 text-body text-fg-muted">{NOTHING}</p>}
              <LookList looks={looks} hidden={hidden} today={today} actions={inSheet} />
            </>}
      </ModalShell>
    </>
  )
}

/** The sheet's loading copy at its rows' geometry. */
function LookSkeleton({ rows }: { rows: number }) {
  return (
    <ul aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-start gap-2.5 py-2">
          <Skeleton rounded="rounded-full" className="mt-0.5 h-7 w-7 shrink-0" />
          <span className="flex flex-1 flex-col gap-1.5 pt-0.5"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-4/5" /></span>
        </li>
      ))}
    </ul>
  )
}
