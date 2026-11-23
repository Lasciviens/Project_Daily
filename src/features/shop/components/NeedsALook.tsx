import { Suspense, useState } from 'react'
import { Eye } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { useIdlePreload } from '../../../shared/hooks/useIdlePreload'
import { lazyPart } from '../../../shared/utils/lazyPage'
import { lookLine, type Look, type RecordFact } from '../shopSuggestions'

// "Needs a look": one button in the Shop page's header that opens every row in a sheet (owner, 23.11.2026; it was a
// card in a right rail, and on a phone one line above the things). Only this button and its count are in the page's
// first download — the sheet and its rows are a chunk of their own, preloaded in idle time.
const NeedsALookSheet = lazyPart('shop-look-sheet', () => import('./NeedsALookSheet').then(m => m.NeedsALookSheet))
const SHEET_PARTS = [NeedsALookSheet]

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

/**
 * Needs a look's one button in the Shop page's header (owner, 23.11.2026: it left the rail, whose room goes to the
 * things): an icon with the count as a badge laid over its corner, in the tone of the most urgent row — the button
 * never changes size, so the bar never reshapes while the rows load or their number changes (THEME §6.3). A tap opens
 * every row in a sheet.
 */
export function NeedsALookButton({ looks, hidden, loading, failed, onRetry, today, actions }: LookState & { actions: LookActions }) {
  const [open, setOpen] = useState(false)
  // Mounted from the first tap on, so the sheet closes with its own transition (and its focus goes back by itself).
  const [mounted, setMounted] = useState(false)
  useIdlePreload(SHEET_PARTS)
  const counted = !loading && !failed && looks.length > 0
  const label = failed && !loading ? 'Needs a look (couldn\'t load)' : counted ? `Needs a look (${looks.length})` : 'Needs a look'
  const claim = counted ? lookLine(looks).claim : null
  // A row's action closes the sheet first (it opens a record or a sheet of its own); Snooze and Got it keep it open.
  const closing = (fn: (look: Look) => void) => (look: Look) => { setOpen(false); fn(look) }
  const inSheet: LookActions = {
    ...actions,
    onOpen: closing(actions.onOpen),
    onBought: closing(actions.onBought),
    onClaim: closing(actions.onClaim),
    onOpenThing: (id: string, fact?: RecordFact) => { setOpen(false); actions.onOpenThing(id, fact) },
  }
  return (
    <>
      <button type="button" data-look-trigger aria-haspopup="dialog" aria-label={label} title={claim ? `${label} · ${claim}` : label} onClick={() => { setMounted(true); setOpen(true) }}
        className={cx('icon-btn-bordered relative h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11', counted && 'text-fg')}>
        <Eye aria-hidden className="h-[18px] w-[18px]" />
        {counted && (
          <span aria-hidden data-tone={looks[0].tone} className="tone-pill absolute -right-1.5 -top-1.5 min-w-[1.25rem] justify-center px-1 tabular-nums shadow-card">{looks.length}</span>
        )}
        {!loading && failed && <span aria-hidden data-tone="warn" className="tone-dot absolute -right-0.5 -top-0.5" />}
      </button>
      {mounted && (
        <Suspense fallback={null}>
          <NeedsALookSheet open={open} onClose={() => setOpen(false)} looks={looks} hidden={hidden} loading={loading} failed={failed} onRetry={onRetry} today={today} actions={inSheet} />
        </Suspense>
      )}
    </>
  )
}
