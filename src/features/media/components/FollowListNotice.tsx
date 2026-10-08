import type { MediaFollow } from '../api/followsApi'

/**
 * New films a ✦ list's Trakt list has not taken yet (Trakt's account limit,
 * an error, Trakt not signed in at the check) and why. They are sent again at
 * the next check — never counted as added before Trakt took them.
 */
export function FollowListNotice({ follow, named = false }: { follow: MediaFollow; named?: boolean }) {
  const n = follow.pending_list_ids?.length ?? 0
  if (!n) return null
  return (
    <p data-tone="warn" role="status" className="tone-soft w-fit max-w-full rounded-row px-3 py-2 text-meta">
      {n} new film{n === 1 ? ' is' : 's are'} not on {named ? `“${follow.name}”` : 'this list'} on Trakt yet
      {follow.list_error ? `: ${follow.list_error}` : ''}. Sent again at the next check (daily, or Check now).
    </p>
  )
}
