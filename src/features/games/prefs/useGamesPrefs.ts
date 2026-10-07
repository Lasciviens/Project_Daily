import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { defaultGamesPrefs, type GamesPrefs } from './gamesPrefs'
import { fetchGamesPrefs, saveGamesPrefs } from './gamesPrefsApi'

const GAMES_PREFS_KEY = qk.games.prefs

/**
 * Games settings shared by every device. `loaded` is false while only the
 * placeholder defaults are shown — nothing may save from that state.
 * Deliberately outside ['games']: a status edit must not refetch it.
 */
export function useGamesPrefs() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: GAMES_PREFS_KEY, queryFn: fetchGamesPrefs, placeholderData: defaultGamesPrefs(), staleTime: 5 * 60_000 })
  const save = useMutationWithFeedback<GamesPrefs, GamesPrefs, { prev?: GamesPrefs }>({
    action: 'save_games_prefs',
    successMessage: 'Saved',
    mutationFn: saveGamesPrefs,
    onMutate: async next => {
      await qc.cancelQueries({ queryKey: GAMES_PREFS_KEY })
      const prev = qc.getQueryData<GamesPrefs>(GAMES_PREFS_KEY)
      qc.setQueryData(GAMES_PREFS_KEY, next)
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(GAMES_PREFS_KEY, ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: GAMES_PREFS_KEY }),
  })
  const loaded = query.isSuccess && !query.isPlaceholderData
  return { prefs: query.data ?? defaultGamesPrefs(), loaded, save }
}
