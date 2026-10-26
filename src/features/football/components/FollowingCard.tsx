import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { MoreHorizontal } from 'lucide-react'
import { Card, CardHeader, Truncate } from '../../../shared/ui'
import { useEntityModal } from '../../../shared/modals'
import { useStopSubscription } from '../hooks/useFootball'
import type { FootballFollow } from '../types'
import { SubscribeToggle } from './SubscribeToggle'
import { TeamLogo } from './TeamLogo'

/**
 * What is followed. A team can be subscribed — its coming matches go into
 * your day by themselves (the owner's word, 19.10.2026: "Subscribe"); a
 * tournament can't (a whole Champions League in the day is never wanted).
 * A team opens its club popup; Unfollow asks and offers Undo (a subscribed
 * team's coming matches leave your day with it — useStopSubscription).
 */
export function FollowingCard({ follows, onPick }: { follows: readonly FootballFollow[]; onPick: (f: FootballFollow) => void }) {
  const modal = useEntityModal()
  const stop = useStopSubscription()
  return (
    <Card>
      <CardHeader title="Following" variant="label" />
      <ul className="-mx-1 flex flex-col">
        {follows.map(f => (
          <li key={f.id} className="flex items-center gap-1">
            <button
              type="button"
              className="row row-interactive min-w-0 flex-1 gap-2.5 text-left"
              onClick={() => (f.kind === 'team' ? modal.open({ kind: 'football-team', teamId: f.ref, league: f.league ?? undefined }) : onPick(f))}
            >
              <TeamLogo src={f.logo} kind={f.kind} size={20} />
              <Truncate className="text-body font-medium text-fg">{f.name}</Truncate>
            </button>
            {f.kind === 'team' && <SubscribeToggle follow={f} />}
            <Menu as="div">
              <MenuButton className="icon-btn shrink-0" aria-label={`More for ${f.name}`}>
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              </MenuButton>
              <MenuItems anchor="bottom end" transition className="menu w-40 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
                <MenuItem>
                  <button type="button" className="menu-item text-danger" disabled={stop.busy} onClick={() => { void stop.unfollow(f) }}>Unfollow</button>
                </MenuItem>
              </MenuItems>
            </Menu>
          </li>
        ))}
      </ul>
    </Card>
  )
}
