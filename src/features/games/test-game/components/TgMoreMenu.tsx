import { useState, type ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Award, Ellipsis, Eye, EyeOff, Flag, FlagOff, Info, ListPlus, ListX, Trash2, Trophy, type LucideIcon } from 'lucide-react'
import { ConfirmDialog } from '../../../../shared/components/ConfirmDialog'
import { useAddToQueue, useDeleteGame, useRemoveFromQueue, useUpdateGame } from '../../hooks/useGames'
import type { TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { useDetailState } from './TgDetailState'
import { useQueuePosition } from './TgMoreMenuQueue'

function Item({ icon: Icon, onClick, danger, children }: { icon: LucideIcon; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <MenuItem>
      <button type="button" onClick={onClick} className={`tg-menu-item [@media(pointer:coarse)]:!min-h-[44px] ${danger ? 'is-danger' : ''}`}>
        <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.9} />
        <span className="flex-1">{children}</span>
      </button>
    </MenuItem>
  )
}

/** The footer's "⋯": queue, hide, review flag, provider pages, full record, delete. */
export function TgMoreMenu({ game, actions }: { game: TgGame; actions: TgActions }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { hiddenByStatus, autoHidden, setStatus } = useDetailState(game)
  const position = useQueuePosition(game.id, game.play_order)
  const addToQueue = useAddToQueue()
  const removeFromQueue = useRemoveFromQueue()
  const updateGame = useUpdateGame()
  const deleteGame = useDeleteGame()

  const queued = game.play_order != null
  const isSteam = game.library === 'steam' && game.steamAppId != null
  const isPsn = game.library === 'playstation'

  return (
    <>
      <Menu>
        <MenuButton aria-label={`More actions for ${game.title}`} className="tg-icon-btn is-bordered">
          <Ellipsis aria-hidden className="h-5 w-5" strokeWidth={2} />
        </MenuButton>
        <MenuItems
          anchor={{ to: 'top end', gap: 8 }}
          transition
          className="tg-portal tg-menu w-[244px] origin-bottom-right transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
        >
          {queued ? (
            <Item icon={ListX} onClick={() => removeFromQueue.mutate(game.id)}>
              Remove from Play Queue
              {position != null && <span className="ml-2 text-[12px] tabular-nums text-[var(--tg-muted)]">#{position}</span>}
            </Item>
          ) : (
            <Item icon={ListPlus} onClick={() => addToQueue.mutate(game.id)}>Add to Play Queue</Item>
          )}
          {!autoHidden && (
            <Item icon={hiddenByStatus ? Eye : EyeOff} onClick={() => setStatus(hiddenByStatus ? 'backlog' : 'hidden')}>
              {hiddenByStatus ? 'Unhide' : 'Hide game'}
            </Item>
          )}
          <Item icon={game.needs_review ? FlagOff : Flag} onClick={() => updateGame.mutate({ id: game.id, patch: { needs_review: !game.needs_review } })}>
            {game.needs_review ? 'Clear review flag' : 'Mark for review'}
          </Item>

          <div className="tg-menu-sep" role="separator" />
          {isSteam && <Item icon={Award} onClick={() => actions.openProvider(game)}>Achievements & store page</Item>}
          {isPsn && <Item icon={Trophy} onClick={() => actions.openProvider(game)}>Trophies</Item>}
          <Item icon={Info} onClick={() => actions.openFull(game.id)}>Full details</Item>

          <div className="tg-menu-sep" role="separator" />
          <Item icon={Trash2} danger onClick={() => setConfirmDelete(true)}>Delete game…</Item>
        </MenuItems>
      </Menu>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${game.title}"?`}
        message="This can't be undone — the game and all its platform entries will be removed from your library."
        confirmLabel="Delete game"
        onConfirm={() => deleteGame.mutate(game.id)}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
