import { useId } from 'react'
import { ListChecks, ListPlus, Pencil } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { TgMoreMenu } from './TgMoreMenu'
import { useQueueToggle } from './TgMoreMenuQueue'
import { TgScrapeButton } from './TgScrapeButton'

/**
 * The pinned footer: Add to queue / In queue · #N · Scrape (retro) or ✎ Edit · ⋯
 *
 * The primary action queues the game (at the end of the Play Queue); once
 * queued it shows the place and a second tap takes it out again. Launching a
 * Steam game lives in the ⋯ menu ("Launch on Steam").
 */
export function TgDetailActions({ game, actions, variant }: { game: TgGame; actions: TgActions; variant: 'panel' | 'sheet' }) {
  const { queued, position, toggle, busy } = useQueueToggle(game)
  const noteId = useId()
  const label = queued ? `In queue${position != null ? ` · #${position}` : ''}` : 'Add to queue'
  const note = queued ? 'Tap to remove from the Play Queue' : 'Adds the game to the end of the Play Queue'

  const pad = variant === 'sheet' ? 'pb-[max(16px,env(safe-area-inset-bottom))]' : 'pb-4'
  const Icon = queued ? ListChecks : ListPlus
  return (
    // The queue button is the widest label ("In queue · #12"); Scrape / Edit are short.
    <div className={`grid shrink-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_44px] gap-2.5 px-5 pt-2 ${pad}`}>
      <button
        type="button"
        onClick={toggle}
        aria-busy={busy}
        title={note}
        aria-describedby={noteId}
        aria-pressed={queued}
        className={`tg-btn !px-3 ${queued ? 'tg-btn-secondary !border-[var(--tg-accent)] !text-[var(--tg-accent)]' : 'tg-btn-primary'}`}
      >
        <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="truncate tabular-nums">{label}</span>
      </button>
      <span id={noteId} hidden>{note}</span>
      {/* ScreenScraper only knows ROMs, so Scrape is a retro action; Steam and
          PlayStation rows keep Edit here (it is in the ⋯ menu for every game). */}
      {game.library === 'retro' ? <TgScrapeButton gameId={game.id} title={game.title} /> : (
        <button type="button" onClick={() => actions.openEdit(game.id)} className="tg-btn tg-btn-secondary !px-3">
          <Pencil aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="truncate">Edit</span>
        </button>
      )}
      <TgMoreMenu game={game} actions={actions} />
    </div>
  )
}
