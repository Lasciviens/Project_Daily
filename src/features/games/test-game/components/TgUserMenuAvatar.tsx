import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { UserRound } from 'lucide-react'

function metaString(user: User, key: string): string | null {
  const v = (user.user_metadata as Record<string, unknown> | undefined)?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** "Furkan Hamdemir" → "FH"; "furkan.hamdemir@…" → "FH"; "lasci@…" → "LA". */
function initialsOf(user: User): string {
  const name = metaString(user, 'full_name') ?? metaString(user, 'name')
  const source = name ?? (user.email ?? '').split('@')[0]
  const words = source.split(/[\s._+-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

/** 36px round avatar: the account's picture, else its initials. */
export function TgUserMenuAvatar({ user }: { user: User | null }) {
  // Remembered per URL so a new picture gets its own chance to load.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const base = 'h-9 w-9 shrink-0 rounded-full ring-1 ring-[var(--tg-border-strong)]'

  if (!user) {
    return (
      <span className={`${base} inline-flex items-center justify-center bg-[var(--tg-panel-2)] text-[var(--tg-muted)]`}>
        <UserRound className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
    )
  }

  const url = metaString(user, 'avatar_url') ?? metaString(user, 'picture')
  if (url && url !== failedUrl) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailedUrl(url)}
        className={`${base} object-cover`}
      />
    )
  }

  return (
    <span className={`${base} inline-flex items-center justify-center bg-[var(--tg-accent-soft)] text-[13px] font-semibold text-[var(--tg-accent)]`}>
      {initialsOf(user)}
    </span>
  )
}
