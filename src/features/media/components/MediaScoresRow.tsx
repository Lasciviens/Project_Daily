import type { ReactNode } from 'react'
import { useMediaScores } from '../trakt/useTraktExtras'
import type { MediaScores } from '../trakt/traktApi'

type Stored = Partial<MediaScores> & { ratings_fetched_at?: string | null }

// Brand marks are identity colours (like Strava orange), so they stay literals.
const ImdbMark = () => (
  <span className="rounded-[3px] bg-[#F5C518] px-1 text-[10px] font-black leading-4 text-black">IMDb</span>
)
const McMark = () => (
  <span className="rounded-[3px] bg-[#333] px-1 text-[10px] font-black leading-4 text-[#FFCC34]">MC</span>
)
const LetterboxdMark = () => (
  <span aria-hidden className="flex h-4 items-center gap-0.5">
    <span className="h-2.5 w-2.5 rounded-full bg-[#FF8000]" />
    <span className="h-2.5 w-2.5 rounded-full bg-[#00E054]" />
    <span className="h-2.5 w-2.5 rounded-full bg-[#40BCF4]" />
  </span>
)
const Emoji = ({ children }: { children: string }) => <span aria-hidden className="text-ui">{children}</span>

function Tile({ mark, value, sub, title, href }: {
  mark: ReactNode; value: string; sub: string; title: string; href?: string | null
}) {
  const body = (
    <>
      <span className="flex h-4 items-center">{mark}</span>
      <span className="text-title font-semibold text-fg tabular-nums">{value}</span>
      <span className="whitespace-nowrap text-micro text-fg-muted">{sub}</span>
    </>
  )
  const cls = 'flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-row border border-line bg-surface-2 px-1 py-1.5 text-center'
  return href
    ? <a href={href} target="_blank" rel="noreferrer" title={title} className={`${cls} hover:border-line-strong`}>{body}</a>
    : <div title={title} className={cls}>{body}</div>
}

export function MediaScoresRow({ mediaType, tmdbId, stored }: {
  mediaType: 'movie' | 'tv'
  tmdbId: number
  stored?: Stored | null
}) {
  const { scores } = useMediaScores(mediaType, tmdbId, stored)
  if (!scores) return null
  const { rt_critics: rt, rt_audience: aud, metacritic: mc, imdb_rating: imdb, letterboxd_rating: lb, rt_url } = scores
  if (rt == null && aud == null && mc == null && imdb == null && lb == null) return null

  return (
    // One row at every width (at most five tiles; ~4.3rem each at 393px) — the
    // old 5.5rem auto-fill put five tiles on two rows on a phone.
    <div className="grid max-w-xl auto-cols-fr grid-flow-col gap-1.5">
      {imdb != null && <Tile mark={<ImdbMark />} value={imdb.toFixed(1)} sub="out of 10" title="IMDb rating (out of 10)" />}
      {rt != null && (
        <Tile mark={<Emoji>{rt >= 60 ? '🍅' : '🤢'}</Emoji>} value={`${rt}%`} sub={rt >= 60 ? 'Fresh' : 'Rotten'}
          title="Rotten Tomatoes — Tomatometer (critics)" href={rt_url} />
      )}
      {aud != null && (
        <Tile mark={<Emoji>🍿</Emoji>} value={`${aud}%`} sub={aud >= 60 ? 'Upright' : 'Spilled'}
          title="Rotten Tomatoes — audience score" href={rt_url} />
      )}
      {mc != null && <Tile mark={<McMark />} value={String(mc)} sub="Metascore" title="Metacritic — Metascore" />}
      {lb != null && <Tile mark={<LetterboxdMark />} value={lb.toFixed(1)} sub="out of 5" title="Letterboxd rating (out of 5)" />}
    </div>
  )
}
