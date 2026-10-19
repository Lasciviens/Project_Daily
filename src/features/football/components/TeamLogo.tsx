import { useState } from 'react'
import { Shield, Trophy } from 'lucide-react'
import { cx } from '../../../shared/ui'

/** A club's or tournament's logo from ESPN's CDN; a plain shield (a trophy for a tournament) when there is none or it fails. */
export function TeamLogo({ src, size = 20, kind = 'team', className }: {
  src: string | null | undefined; size?: number; kind?: 'team' | 'league'; className?: string
}) {
  const [failed, setFailed] = useState(false)
  const box = { width: size, height: size }
  if (!src || failed) {
    const Icon = kind === 'league' ? Trophy : Shield
    return <Icon aria-hidden style={box} className={cx('shrink-0 text-fg-faint', className)} strokeWidth={1.75} />
  }
  return (
    <img
      src={src} alt="" aria-hidden loading="lazy" decoding="async" referrerPolicy="no-referrer"
      style={box} className={cx('shrink-0 object-contain', className)} onError={() => setFailed(true)}
    />
  )
}
