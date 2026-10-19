import { Bell, BellRing } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { useSetSubscribed } from '../hooks/useFootball'
import type { FootballFollow } from '../types'

/** A followed team's "Subscribe": its coming matches go into your day by themselves (owner's word, 19.10.2026). */
export function SubscribeToggle({ follow }: { follow: FootballFollow }) {
  const subscribe = useSetSubscribed()
  const on = follow.subscribed
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={subscribe.isPending}
      onClick={() => subscribe.mutate({ follow, on: !on })}
      title={on ? 'Its coming matches go into your day — tap to stop' : 'Put its coming matches in your day'}
      className={cx('shrink-0 gap-1', on ? 'tone-pill' : 'chip')}
      data-tone={on ? 'info' : undefined}
    >
      {on ? <BellRing aria-hidden className="h-3.5 w-3.5" /> : <Bell aria-hidden className="h-3.5 w-3.5" />}
      {on ? 'Subscribed' : 'Subscribe'}
    </button>
  )
}
