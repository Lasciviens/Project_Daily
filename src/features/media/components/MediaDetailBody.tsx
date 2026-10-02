import { posterUrl } from '../../../integrations/tmdb/client'
import { SimilarRow } from './SimilarRow'
import { EpisodesPanel } from './EpisodesPanel'
import { MediaDetailInfo } from './MediaDetailInfo'
import { MediaLibraryControls } from './MediaLibraryControls'
import { MediaScoresRow } from './MediaScoresRow'
import { CollectionListButton } from './CollectionListButton'
import type { TMDBMovieFull, TMDBTVFull, UserMovieEntry, UserTVEntry, MediaType, OpenMediaDetail } from '../types'

interface Props {
  detail: TMDBMovieFull | TMDBTVFull
  mediaType: MediaType
  userEntry?: UserMovieEntry | UserTVEntry | null
  onRemoved?: () => void
  onOpenDetail?: OpenMediaDetail
}

export function MediaDetailBody({ detail, mediaType, userEntry, onRemoved, onOpenDetail }: Props) {
  const isMovie = mediaType === 'movie'
  const tv = !isMovie ? (detail as TMDBTVFull) : null
  const tvEntryId = !isMovie && userEntry ? userEntry.id : null
  const stored = userEntry ? ('movie' in userEntry ? userEntry.movie : (userEntry as UserTVEntry).tv_series) : null

  const controls = <MediaLibraryControls detail={detail} isMovie={isMovie} userEntry={userEntry} onRemoved={onRemoved} />

  // Phones: one column — facts, your controls, episodes, similar.
  // md+: your poster and controls in a narrow left rail (what you act on sits
  // high, never pushed under the episode list), the TMDB facts on the right.
  return (
    <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* md+: the rail stays put while the facts and episodes scroll. It is
          as tall as the popup's scroll area at most (88dvh − the 14rem hero −
          padding) and scrolls inside itself when the controls are longer. */}
      <aside className="scroll-y order-2 flex min-w-0 flex-col gap-4 md:order-1 md:sticky md:top-5 md:max-h-[calc(88dvh-14rem-2.5rem)] md:self-start md:overflow-y-auto md:overscroll-contain md:pr-1">
        {/* The hero already shows the poster on phones. */}
        <img
          src={posterUrl(detail.poster_path, 'w342')}
          alt=""
          className="hidden aspect-[2/3] w-28 rounded-row bg-surface-2 object-cover md:block"
        />
        <div className="border-t border-line pt-4 md:border-t-0 md:pt-0">{controls}</div>
      </aside>

      <div className="order-1 flex min-w-0 flex-col gap-5 md:order-2">
        <MediaDetailInfo
          detail={detail}
          isMovie={isMovie}
          afterMeta={<>
            <MediaScoresRow mediaType={mediaType} tmdbId={detail.id} stored={stored} />
            {isMovie && <CollectionListButton movie={detail as TMDBMovieFull} onOpenDetail={onOpenDetail} />}
          </>}
        />
        {tv && tvEntryId && (tv.seasons?.length ?? 0) > 0 && <div className="hidden md:block"><EpisodesPanel tv={tv} tvEntryId={tvEntryId} /></div>}
        <div className="hidden md:block">
          <SimilarRow tmdbId={detail.id} mediaType={mediaType} onOpenDetail={(id, type) => onOpenDetail?.(id, type)} />
        </div>
      </div>

      {/* Phones: episodes and similar come after the controls. */}
      {tv && tvEntryId && (tv.seasons?.length ?? 0) > 0 && <div className="order-3 md:hidden"><EpisodesPanel tv={tv} tvEntryId={tvEntryId} /></div>}
      <div className="order-4 md:hidden">
        <SimilarRow tmdbId={detail.id} mediaType={mediaType} onOpenDetail={(id, type) => onOpenDetail?.(id, type)} />
      </div>
    </div>
  )
}
