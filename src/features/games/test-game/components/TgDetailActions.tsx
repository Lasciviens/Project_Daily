import { useId } from 'react'
import { Pencil, Play } from 'lucide-react'
import { toast } from '../../../../app/store'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { useDetailState } from './TgDetailState'
import { TgMoreMenu } from './TgMoreMenu'
import { TgScrapeButton } from './TgScrapeButton'

const ALREADY_PLAYING = 'Already playing — launching from the web works for Steam games only'
const MARKS_PLAYING = 'Marks the game as Playing — launching from the web works for Steam games only'

/** The pinned footer: ▶ Play · Scrape (retro) or ✎ Edit · ⋯ */
export function TgDetailActions({ game, actions, variant }: { game: TgGame; actions: TgActions; variant: 'panel' | 'sheet' }) {
  const { status, setStatus } = useDetailState(game)
  const noteId = useId()
  const appId = game.steamAppId
  const note = appId != null ? 'Launch in Steam' : status === 'playing' ? ALREADY_PLAYING : MARKS_PLAYING

  // Always the vivid primary "▶ Play", as drawn: a greyed-out button read as
  // broken for exactly the state the design shows (a retro game being played).
  function play() {
    if (appId != null) {
      // Status first: the protocol hand-off can stall the page behind an
      // "Open Steam?" prompt, and the write should not wait on it.
      if (status === 'backlog' || status === 'wishlist') setStatus('playing')
      window.location.href = `steam://rungameid/${appId}`
      return
    }
    if (status === 'playing') toast.info(ALREADY_PLAYING)
    else setStatus('playing')
  }

  const pad = variant === 'sheet' ? 'pb-[max(16px,env(safe-area-inset-bottom))]' : 'pb-4'
  return (
    <div className={`grid shrink-0 grid-cols-[minmax(0,0.89fr)_minmax(0,1fr)_44px] gap-2.5 px-5 pt-2 ${pad}`}>
      <button type="button" onClick={play} title={note} aria-describedby={noteId} className="tg-btn tg-btn-primary !px-3">
        <Play aria-hidden className="h-4 w-4 shrink-0" fill="currentColor" strokeWidth={1.5} />
        <span className="truncate">Play</span>
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
