import { useMemo, useState } from 'react'
import { heroCandidates, type TgGame } from '../testGameModel'
import { firstLiveCover } from './coverCache'
import { useStableValue } from './useStableValue'

interface Props {
  /** The selected game, or null (nothing picked yet, or not a game section). */
  selected: TgGame | null
  games: TgGame[]
}

/**
 * The blurred art behind the header, from the selected game — and nothing
 * until the user picks one. Arrowing along the shelf passes a game every few
 * frames, so the full-size picture follows only once the selection rests, and
 * skips art the session knows is dead. When the selection goes it fades out
 * on its last picture instead of vanishing.
 */
export function TgDetailOverlayBackdrop({ selected, games }: Props) {
  const restingId = useStableValue(selected?.id ?? null, 250)
  const resting = useMemo(() => games.find(g => g.id === restingId) ?? null, [games, restingId])
  const url = selected && resting ? firstLiveCover(heroCandidates(resting)) : null
  const [last, setLast] = useState(url)
  if (url && url !== last) setLast(url)

  if (!last) return null
  return <div aria-hidden className="tg-backdrop" style={{ backgroundImage: `url("${last}")`, ...(!url && { opacity: 0 }) }} />
}
