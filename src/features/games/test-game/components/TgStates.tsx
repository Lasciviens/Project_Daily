import type { ReactNode } from 'react'
import { FilterX, Inbox, LibraryBig, ListVideo, Plus, RotateCw, SearchX, TriangleAlert } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import { useTgBreakpoint } from '../useTgBreakpoint'
import { STATUS_TEXT, type TgSection } from '../testGameModel'
import type { PlayStatus } from '../../types'
import {
  TgStatesGridSkeleton, TgStatesListSkeleton, TgStatesMobileSkeleton, TgStatesShelfSkeleton,
} from './TgStatesSkeletons'

const ICON = { size: 26, strokeWidth: 1.75 } as const

function StateCard({ icon, tone = 'accent', title, children, actions }: {
  icon: ReactNode; tone?: 'accent' | 'danger'; title: string; children?: ReactNode; actions?: ReactNode
}) {
  const glyph = tone === 'danger'
    ? 'bg-[var(--tg-red-soft)] text-[var(--tg-red)]'
    : 'bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]'
  return (
    <div className="h-full min-h-[300px] flex">
      <div className="tg-panel tg-fade-in flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
        <span className={`grid h-14 w-14 place-items-center rounded-2xl ${glyph}`}>{icon}</span>
        <h2 className="mt-4 text-[17px] font-semibold text-[var(--tg-text)]">{title}</h2>
        {children && <p className="mt-1.5 max-w-md text-[13px] leading-relaxed tg-muted">{children}</p>}
        {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

function sectionHint(section: TgSection, statuses: PlayStatus[]): string {
  if (section === 'library' && statuses.length === 1 && statuses[0] === 'hidden') return 'No hidden games on this shelf.'
  if (section === 'library' && statuses.length === 1) return `No ${STATUS_TEXT[statuses[0]].toLowerCase()} games on this shelf yet.`
  if (section === 'library' && statuses.length > 1) {
    return `No ${statuses.map(s => STATUS_TEXT[s].toLowerCase()).join(' or ')} games on this shelf yet.`
  }
  if (section === 'wishlist' || section === 'completed' || section === 'backlog') {
    return `Games you mark as ${STATUS_TEXT[section]} show up here.`
  }
  return 'Games show up here as soon as one fits this view.'
}

export function TgEmptyState({ kind }: { kind: 'library' | 'filtered' | 'queue' | 'section' }) {
  const section = useTestGameStore(s => s.section)
  const statuses = useTestGameStore(s => s.statuses)
  const search = useTestGameStore(s => s.search)
  // Setters are read at click time; subscribing to them would only add renders.
  const act = useTestGameStore.getState

  if (kind === 'library') {
    return (
      <StateCard icon={<LibraryBig {...ICON} />} title="Your library is empty" actions={<>
        <button type="button" className="tg-btn tg-btn-primary" onClick={() => act().setAdvancedTab('tools')}>
          <Plus size={17} strokeWidth={2} />Add a game
        </button>
        <button type="button" className="tg-btn tg-btn-secondary" onClick={() => act().setAdvancedTab('steam')}>Open Steam</button>
        <button type="button" className="tg-btn tg-btn-secondary" onClick={() => act().setAdvancedTab('playstation')}>Open PlayStation</button>
      </>}>
        Add a game by hand in Advanced → Add &amp; random, or import your Steam and PlayStation
        libraries from their tabs in Advanced.
      </StateCard>
    )
  }

  if (kind === 'filtered') {
    const clear = () => { const s = act(); s.setSearch(''); s.clearFilters() }
    return (
      <StateCard icon={<SearchX {...ICON} />} title="No games match your search or filters" actions={
        <button type="button" className="tg-btn tg-btn-primary" onClick={clear}>
          <FilterX size={17} strokeWidth={2} />Clear search &amp; filters
        </button>
      }>
        {search.trim() ? `Nothing here matches “${search.trim()}”. ` : ''}Clear them to see every game again.
      </StateCard>
    )
  }

  if (kind === 'queue') {
    return (
      <StateCard icon={<ListVideo {...ICON} />} title="Your play queue is empty" actions={
        <button type="button" className="tg-btn tg-btn-secondary" onClick={() => act().setSection('library')}>Browse library</button>
      }>
        Open any game and choose ⋯ → Add to Play Queue to line up what to play next.
      </StateCard>
    )
  }

  const narrowed = section === 'library' && statuses.length > 0
  return (
    <StateCard icon={<Inbox {...ICON} />} title="Nothing here yet" actions={narrowed && (
      <button type="button" className="tg-btn tg-btn-secondary" onClick={() => act().setStatus('all')}>Show all games</button>
    )}>
      {sectionHint(section, statuses)}
    </StateCard>
  )
}

/** Shaped like the view that will replace it, so the page never flashes. */
export function TgLoadingShelf() {
  const bp = useTgBreakpoint()
  const section = useTestGameStore(s => s.section)
  const view = useTestGameStore(s => s.view)

  let skeleton: ReactNode
  if (bp === 'mobile') skeleton = <TgStatesMobileSkeleton />
  else if (section === 'queue') skeleton = <TgStatesListSkeleton variant="queue" />
  else if (view === 'list') skeleton = <TgStatesListSkeleton variant="list" />
  else if (view === 'grid') skeleton = <TgStatesGridSkeleton />
  else skeleton = <TgStatesShelfSkeleton />

  return (
    <div role="status" aria-live="polite" className="h-full">
      <span className="sr-only">Loading your library…</span>
      {skeleton}
    </div>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message
  }
  return 'Something went wrong while loading your games.'
}

export function TgErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <StateCard icon={<TriangleAlert {...ICON} />} tone="danger" title="Couldn't load your library" actions={
      <button type="button" className="tg-btn tg-btn-primary" onClick={onRetry}>
        <RotateCw size={17} strokeWidth={2} />Try again
      </button>
    }>
      <span className="break-words">{messageOf(error)}</span>
    </StateCard>
  )
}

/** Steam or PlayStation failed while the retro library loaded: the page stays
 *  usable, and this says why those games are missing instead of hiding them. */
export function TgProviderError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="tg-fade-in mb-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-[var(--tg-red-soft)] py-1.5 pl-3.5 pr-1.5">
      <TriangleAlert aria-hidden size={18} strokeWidth={2} className="shrink-0 text-[var(--tg-red)]" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--tg-text)]">
        <span className="font-semibold">Your Steam or PlayStation games couldn't be loaded.</span>{' '}
        <span className="break-words tg-muted">{messageOf(error)}</span>
      </p>
      <button type="button" className="tg-btn tg-btn-secondary !px-3.5" onClick={onRetry}>
        <RotateCw size={16} strokeWidth={2} />Try again
      </button>
    </div>
  )
}
