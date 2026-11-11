import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import {
  AlarmClock, BadgeAlert, CalendarClock, Check, ChevronDown, ChevronRight, Hourglass, ListChecks, MoreHorizontal, PackageCheck,
  RotateCcw, ShieldAlert, Tag, Target, TrendingDown, Undo2, type LucideIcon,
} from 'lucide-react'
import { Card, CardHeader, KeepRoom, MetaLine, Skeleton, Truncate, cx, useBoardStep } from '../../../shared/ui'
import { ModalShell } from '../../../shared/modals'
import { formatDate } from '../../../shared/utils/dateFormat'
import { lookLine, SNOOZE_DAYS, type Look, type LookKind, type LookThing } from '../shopSuggestions'
import { addDays } from '../ownModel'

// "Needs a look": on a wide page a card in the right rail (owner, 14.10.2026:
// where Coming up sat), on a phone one line that opens every row in a sheet
// (owner, 09.11.2026: the phone's first screen is the things themselves).
// Each row has its one action, and Snooze (a week, or until the day before
// its deadline) · Got it behind ⋯.

const ICON: Record<LookKind, LucideIcon> = {
  return_closing: RotateCcw, cheaper_returnable: TrendingDown, at_target: Target, lowest_seen: TrendingDown, back_in_stock: PackageCheck,
  fake_before: BadgeAlert, deal_day: CalendarClock, complaint_ending: ShieldAlert, old_value: Tag, old_wish: Hourglass, tidy_up: ListChecks,
}
const ACTION: Record<Look['action'], string> = { open: 'Open', bought: 'Bought', value: 'Update', list: 'Show' }
/** The rail shows this many rows, then "N more". */
const SHOWN = 3

export interface LookActions {
  /** Open the thing (an old "Could sell for": at that fact). */
  onOpen: (look: Look) => void
  onBought: (look: Look) => void
  onSnooze: (look: Look) => void
  onGotIt: (look: Look) => void
  onShowAgain: (look: Look) => void
  /** Open one of the things a counting row lists. */
  onOpenThing: (id: string) => void
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

/** The kind's icon on its tone: the icon and the words say it, never the colour alone. */
function LookIcon({ look, small = false }: { look: Look; small?: boolean }) {
  const Icon = ICON[look.kind]
  return (
    <span data-tone={look.tone} className={cx('tone-soft grid shrink-0 place-items-center rounded-full', small ? 'h-6 w-6' : 'mt-0.5 h-7 w-7')}>
      <Icon aria-hidden className={cx('tone-text', small ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
    </span>
  )
}

/**
 * The facts as one "a · b · c" line; where a price was read follows its price
 * as one piece ("2 990 NOK at elkjop.no") that only an overlong address breaks.
 */
function lookFacts(look: Look) {
  if (!look.where || !look.facts.length) return look.facts
  const last = look.facts[look.facts.length - 1]
  return [...look.facts.slice(0, -1), <span key="w">{last} <span className="whitespace-normal break-words">{look.where}</span></span>]
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
  const act = () => (look.action === 'bought' ? actions.onBought(look) : open())
  return (
    <li className="flex items-start gap-0.5">
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-row px-2 py-2 text-left transition-colors hover:bg-surface-hover">
        <LookIcon look={look} />
        <span className="min-w-0 flex-1">
          <Truncate as="span" className="block text-body font-medium text-fg">{look.title}</Truncate>
          <MetaLine as="span" className="block text-meta tabular-nums text-fg-muted" items={lookFacts(look)} />
        </span>
      </button>
      <span className="flex shrink-0 items-center pt-1">
        <button type="button" onClick={act} aria-label={`${ACTION[look.action]}: ${look.title}`}
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
function ThingsSheet({ look, onClose, onOpenThing }: { look: Look; onClose: () => void; onOpenThing: (id: string) => void }) {
  return (
    <ModalShell open onClose={onClose} title={look.title} size="sm"
      subtitle={look.kind === 'deal_day' ? look.facts.slice(0, 2).join(' · ') : undefined}>
      <ul className="-mx-2 flex flex-col">
        {look.things.map((t: LookThing) => (
          <li key={t.id}>
            <button type="button" onClick={() => onOpenThing(t.id)}
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

/** The rows' loading copy, at their geometry. */
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

const NOTHING = 'Nothing needs a look right now.'

/** The rail's card: three rows, then "N more"; its room is kept while it loads. */
export function NeedsALookPanel({ looks, hidden, loading, failed, onRetry, today, actions }: LookState & { actions: LookActions }) {
  return (
    <Card>
      <CardHeader title="Needs a look" variant="label" className="mb-1"
        action={!loading && !failed && looks.length > 0 ? <span className="count-badge">{looks.length}</span> : undefined} />
      <KeepRoom ids="shop:look" loading={loading} remember={!failed} skeleton={<LookSkeleton rows={SHOWN} />}>
        {failed
          ? <p className="py-1"><LookFailed onRetry={onRetry} /></p>
          : <>
            {!looks.length && <p className="py-1 text-body text-fg-muted">{NOTHING}</p>}
            <LookList looks={looks} hidden={hidden} limit={SHOWN} today={today} actions={actions} />
          </>}
      </KeepRoom>
    </Card>
  )
}

/**
 * The phone's one line — "9 need a look · 500 NOK to claim ›" — in the most
 * urgent row's tone; it opens every row in a sheet. One line in every outcome,
 * loading included, so nothing under it moves — but none at all on a page
 * with nothing on it (`quiet`: an empty wishlist), where "Nothing needs a
 * look" would only be a filler line.
 */
export function NeedsALookLine({ looks, hidden, loading, failed, onRetry, today, actions, quiet = false }: LookState & { actions: LookActions; quiet?: boolean }) {
  const [open, setOpen] = useState(false)
  if (quiet && !failed && (loading || (!looks.length && !hidden.length))) return null
  if (loading) return <Skeleton rounded="rounded-row" className="h-11 w-full" />
  if (failed) return <p className="flex h-11 items-center rounded-row border border-line bg-surface px-3"><LookFailed onRetry={onRetry} /></p>
  const line = lookLine(looks)
  if (!line.count && !hidden.length) {
    return (
      <p className="flex h-11 items-center gap-2 rounded-row border border-line bg-surface px-3 text-body text-fg-muted">
        <Check aria-hidden className="h-4 w-4 shrink-0" /> {line.words}
      </p>
    )
  }
  const words = line.claim ? `${line.words} · ${line.claim}` : line.words
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className={cx('flex h-11 w-full items-center gap-2.5 rounded-row border border-line bg-surface px-3 text-left', line.count > 0 && 'shadow-card')}>
        {looks.length > 0
          ? <LookIcon look={looks[0]} small />
          : <Check aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />}
        <Truncate as="span" fullText={words} className={cx('min-w-0 flex-1 text-body tabular-nums', line.count ? 'text-fg-2' : 'text-fg-muted')}>
          <span className={cx(line.count > 0 && 'font-semibold text-fg')}>{line.words}</span>{line.claim && ` · ${line.claim}`}
        </Truncate>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
      </button>
      <ModalShell open={open} onClose={() => setOpen(false)} title="Needs a look"
        subtitle={looks.length ? `${looks.length} to look at${line.claim ? ` · ${line.claim}` : ''}` : undefined}>
        {!looks.length && <p className="pb-1 text-body text-fg-muted">{NOTHING}</p>}
        <LookList looks={looks} hidden={hidden} today={today} actions={actions} />
      </ModalShell>
    </>
  )
}

/** The line on a phone (one stack), the rail's card on a wide page. */
export function NeedsALook({ quiet, ...props }: LookState & { actions: LookActions; quiet?: boolean }) {
  return useBoardStep() === 1 ? <NeedsALookLine {...props} quiet={quiet} /> : <NeedsALookPanel {...props} />
}
