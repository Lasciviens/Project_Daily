import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { deleteRows } from '../../../shared/utils/deletedRows'
import { toast } from '../../../app/store'
import { fetchMatches, fetchUnmatched, saveMatch, type ManualMatch, type MatchKind } from './traktMatchApi'
import { useSyncTrakt } from './useTrakt'

export function useTraktUnmatched(enabled: boolean) {
  return useQuery({ queryKey: qk.trakt.unmatched(), queryFn: fetchUnmatched, enabled, staleTime: STALE.short, retry: false })
}

export function useTraktMatches(enabled: boolean) {
  return useQuery({ queryKey: qk.trakt.matches(), queryFn: fetchMatches, enabled, staleTime: STALE.short, retry: false })
}

export interface PickInput {
  kind: MatchKind
  trakt_id: number
  tmdb_id: number
  /** The picked title's name, for the toast. */
  pickTitle: string
  /** The pick this one replaces, so Undo can put it back. */
  previous: ManualMatch | null
}

/** Puts a pick back as it was before a save: the old TMDB id, or no row when there was none. */
function useUndoPick() {
  return useMutationWithFeedback({
    action: 'undo_trakt_match',
    silent: 'its own toast reports it',
    mutationFn: async ({ saved, previous }: { saved: ManualMatch; previous: ManualMatch | null }) => {
      if (previous) await saveMatch(previous)
      else await deleteRows('trakt_manual_matches', [saved.id])
    },
    onSuccess: () => toast.success('Match undone'),
    invalidates: [qk.trakt.unmatched(), qk.trakt.matches()],
  })
}

/**
 * Saves the owner's pick for a Trakt title: "Matched to X — the next sync links it · Sync now · Undo". The sync runs every
 * 30 minutes by itself; Sync now is the app's own button for the same run.
 */
export function useSaveTraktMatch() {
  const undo = useUndoPick()
  const sync = useSyncTrakt()
  return useMutationWithFeedback({
    action: 'save_trakt_match',
    silent: 'its own toast reports it with Sync now and Undo',
    mutationFn: (v: PickInput) => saveMatch(v),
    onSuccess: (saved, v) => {
      toast.doneWith(`Matched to ${v.pickTitle} — the next sync links it`, { label: 'Sync now', onClick: () => sync.mutate({ full: true }) },
        () => undo.mutate({ saved, previous: v.previous }))
    },
    invalidates: [qk.trakt.unmatched(), qk.trakt.matches()],
  })
}

/** Removes a pick: asks first, then "Match removed · Undo". */
export function useRemoveTraktMatch() {
  const del = useRowsDelete({ table: 'trakt_manual_matches', action: 'remove_trakt_match', invalidates: [qk.trakt.unmatched(), qk.trakt.matches()], cache: qk.trakt.matches() })
  return {
    busy: del.busy,
    remove: (m: ManualMatch, name: string) => del.run([m.id], {
      title: 'Remove this match?',
      message: `${name} may leave your library at the next sync, because Trakt doesn't know it by that name. Your watches stay on Trakt.`,
      confirmLabel: 'Remove match',
      done: 'Match removed',
      restored: 'Match put back',
    }),
  }
}
