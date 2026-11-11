// The item screen's red dot reads the queue's own answer for the item (2b-2): when an edit opens on an item that
// belongs in Apple Calendar but has no Apple copy, its row is sent now — named, so it goes first — and the server
// says what it did with it (sent, failed with its reason, waiting for its retry, not queued). Once per version of the
// row (its updated_at), so a later save asks again; never retried by itself (the 5-minute timer does that).
import { useQuery } from '@tanstack/react-query'
import { qk } from '../../../shared/query'
import { drainICloudNow } from './appleAreas'
import type { AppleSend, DrainItemRef } from './appleSendRules'

export function useAppleItemSend(ref: DrainItemRef | null, version: string | null | undefined) {
  return useQuery({
    queryKey: qk.icloud.itemSend(ref?.entity ?? '', ref?.id ?? '', version ?? ''),
    queryFn: async (): Promise<AppleSend> => {
      const r = await drainICloudNow({ items: [ref as DrainItemRef] })
      return { item: r.item, problem: r.problem, busy: r.busy }
    },
    enabled: !!ref,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
