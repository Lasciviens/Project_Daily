import { useState, type ReactNode } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Award, Ellipsis, Gamepad2, Eye, EyeOff, Flag, FlagOff, Info, ListPlus, ListX, Pencil, Trash2, Trophy } from 'lucide-react'
import { useAddToQueue, useDeleteGame, useRemoveFromQueue, useUpdateGame } from '../../hooks/useGames'
import { STATUS_TEXT, type TgGame } from '../testGameModel'
import type { PlayStatus } from '../../types'
import type { TgActions } from '../tgTypes'
import { useDetailState } from './TgDetailState'
import { useQueuePosition } from './TgMoreMenuQueue'
import { TgStatusIcon } from './TgStatusIcon'
import { TgConfirmDialog } from './TgConfirmDialog'
import { useSteamLaunch } from './tgSteamLaunch'

// The statuses that keep a "not a game" Steam app visible (Backlog would hide it again).
const SHOW_AS: PlayStatus[] = ['playing', 'completed', 'wishlist', 'dropped']
const ICON = 'h-4 w-4 shrink-0'

function Item({ icon, onClick, danger, children }: { icon: ReactNode; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <MenuItem>
      <button type="button" onClick={onClick} className={`tg-menu-item [@media(pointer:coarse)]:!min-h-[44px] ${danger ? 'is-danger' : ''}`}>
        {icon}
        <span className="flex-1">{children}</span>
      </button>
    </MenuItem>
  )
}

/** The footer's "⋯": edit, queue, hide, review flag, provider pages, classic record, delete. */
export function TgMoreMenu({ game, actions }: { game: TgGame; actions: TgActions }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { hiddenByStatus, autoHidden, setStatus } = useDetailState(game)
  const position = useQueuePosition(game.id)
  const addToQueue = useAddToQueue()
  const removeFromQueue = useRemoveFromQueue()
  const updateGame = useUpdateGame()
  const deleteGame = useDeleteGame()
  const launchSteam = useSteamLaunch(game)

  const queued = game.play_order != null
  const isSteam = game.library === 'steam' && game.steamAppId != null
  const isPsn = game.library === 'playstation'
  // Same rule as the status pill: no Unhide that the auto-hide rule would undo.
  const mustDecide = autoHidden || (game.notAGame && hiddenByStatus)
  // A synced row is re-created by its sync (the Steam/PSN import, the
  // handheld's ES-DE push) — a delete loses your status, rating and notes and
  // the game comes back anyway. Hide is what actually keeps it out.
  const syncedBy = game.library === 'steam' ? 'your next Steam import'
    : game.library === 'playstation' ? 'your next PlayStation import'
    : game.platforms.some(p => !!p.esde_path) ? 'the handheld’s next ES-DE sync'
    : null

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
          <Item icon={<Pencil aria-hidden className={ICON} strokeWidth={1.9} />} onClick={() => actions.openEdit(game.id)}>Edit details</Item>
          {launchSteam && <Item icon={<Gamepad2 aria-hidden className={ICON} strokeWidth={1.9} />} onClick={launchSteam}>Launch on Steam</Item>}
          <div className="tg-menu-sep" role="separator" />
          {queued ? (
            <Item icon={<ListX aria-hidden className={ICON} strokeWidth={1.9} />} onClick={() => removeFromQueue.mutate(game.id)}>
              Remove from Play Queue
              {position != null && <span className="ml-2 text-[12px] tabular-nums text-[var(--tg-muted)]">#{position}</span>}
            </Item>
          ) : (
            <Item icon={<ListPlus aria-hidden className={ICON} strokeWidth={1.9} />} onClick={() => addToQueue.mutate(game.id)}>Add to Play Queue</Item>
          )}
          {!mustDecide && (
            <Item
              icon={hiddenByStatus ? <Eye aria-hidden className={ICON} strokeWidth={1.9} /> : <EyeOff aria-hidden className={ICON} strokeWidth={1.9} />}
              onClick={() => setStatus(hiddenByStatus ? 'backlog' : 'hidden')}
            >
              {hiddenByStatus ? 'Unhide' : 'Hide game'}
            </Item>
          )}
          <Item
            icon={game.needs_review ? <FlagOff aria-hidden className={ICON} strokeWidth={1.9} /> : <Flag aria-hidden className={ICON} strokeWidth={1.9} />}
            onClick={() => updateGame.mutate({ id: game.id, patch: { needs_review: !game.needs_review } })}
          >
            {game.needs_review ? 'Clear review flag' : 'Mark for review'}
          </Item>

          {mustDecide && (
            <>
              <div className="tg-menu-sep" role="separator" />
              <p className="px-2.5 pb-1 pt-1.5 text-[12px] leading-snug text-[var(--tg-muted)]">
                Hidden — {game.library === 'playstation' ? 'PlayStation lists this as an app, not a game' : 'Steam does not list this as a game'}. Show it as:
              </p>
              {SHOW_AS.map(s => (
                <Item key={s} icon={<TgStatusIcon status={s} size={14} />} onClick={() => setStatus(s)}>{STATUS_TEXT[s]}</Item>
              ))}
            </>
          )}

          <div className="tg-menu-sep" role="separator" />
          {isSteam && <Item icon={<Award aria-hidden className={ICON} strokeWidth={1.9} />} onClick={() => actions.openProvider(game)}>Achievements & store page</Item>}
          {isPsn && <Item icon={<Trophy aria-hidden className={ICON} strokeWidth={1.9} />} onClick={() => actions.openProvider(game)}>Trophies</Item>}
          {/* Platform add/edit/delete still lives in the classic modal — retro rows only (Steam/PSN have none). */}
          {game.library === 'retro' && <Item icon={<Info aria-hidden className={ICON} strokeWidth={1.9} />} onClick={() => actions.openFull(game.id)}>Manage platforms…</Item>}

          <div className="tg-menu-sep" role="separator" />
          <Item icon={<Trash2 aria-hidden className={ICON} strokeWidth={1.9} />} danger onClick={() => setConfirmDelete(true)}>Delete game…</Item>
        </MenuItems>
      </Menu>

      {syncedBy && !hiddenByStatus ? (
        <TgConfirmDialog
          open={confirmDelete}
          title={`Remove "${game.title}"?`}
          message={`Deleting it is not permanent: ${syncedBy} adds it back — as a new entry, without your status, rating or notes. Hide keeps it out of your library and remembers everything.`}
          confirmLabel="Hide instead"
          onConfirm={() => setStatus('hidden')}
          onClose={() => setConfirmDelete(false)}
          secondary={{ label: 'Delete anyway', danger: true, onClick: () => deleteGame.mutate(game.id) }}
        />
      ) : (
        <TgConfirmDialog
          danger
          open={confirmDelete}
          title={`Delete "${game.title}"?`}
          message={syncedBy
            ? `${syncedBy[0].toUpperCase()}${syncedBy.slice(1)} adds it back as a new entry, without your status, rating or notes.`
            : "This can't be undone — the game and all its platform entries will be removed from your library."}
          confirmLabel="Delete game"
          onConfirm={() => deleteGame.mutate(game.id)}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
