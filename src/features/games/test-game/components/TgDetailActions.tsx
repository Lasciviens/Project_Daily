import { Check, Pencil, Play } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { useDetailState } from './TgDetailState'
import { TgMoreMenu } from './TgMoreMenu'

const WEB_LAUNCH_NOTE = 'Launching from the web works for Steam games only'

/** The pinned footer: ▶ Play · ✎ Edit · ⋯ */
export function TgDetailActions({ game, actions, variant }: { game: TgGame; actions: TgActions; variant: 'panel' | 'sheet' }) {
  const { status, setStatus } = useDetailState(game)
  const appId = game.steamAppId
  const isPlaying = appId == null && status === 'playing'

  function play() {
    if (appId != null) {
      // Status first: the protocol hand-off can stall the page behind an
      // "Open Steam?" prompt, and the write should not wait on it.
      if (status === 'backlog' || status === 'wishlist') setStatus('playing')
      window.location.href = `steam://rungameid/${appId}`
      return
    }
    setStatus('playing')
  }

  const pad = variant === 'sheet' ? 'pb-[max(16px,env(safe-area-inset-bottom))]' : 'pb-4'
  return (
    <div className={`grid shrink-0 grid-cols-[minmax(0,0.89fr)_minmax(0,1fr)_44px] gap-2.5 px-5 pt-2 ${pad}`}>
      {/* The title sits on a wrapper too: some browsers show no tooltip for a disabled button. */}
      <span className="flex min-w-0" title={isPlaying ? WEB_LAUNCH_NOTE : undefined}>
        <button
          type="button"
          onClick={play}
          disabled={isPlaying}
          title={isPlaying ? WEB_LAUNCH_NOTE : appId != null ? 'Launch in Steam' : undefined}
          className="tg-btn tg-btn-primary w-full !px-3"
        >
          {isPlaying
            ? <Check aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            : <Play aria-hidden className="h-4 w-4 shrink-0" fill="currentColor" strokeWidth={1.5} />}
          <span className="truncate">{isPlaying ? 'Playing' : 'Play'}</span>
        </button>
      </span>
      <button type="button" onClick={() => actions.openEdit(game.id)} className="tg-btn tg-btn-secondary !px-3">
        <Pencil aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="truncate">Edit</span>
      </button>
      <TgMoreMenu game={game} actions={actions} />
    </div>
  )
}
