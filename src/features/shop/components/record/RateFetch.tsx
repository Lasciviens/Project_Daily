import { RefreshCw } from 'lucide-react'
import { Button } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useFetchRatesAgain } from '../../hooks/useShopMoney'

/**
 * Above a rate's editor while the rate is missing (owner, 23.11.2026): what the app knows — "Norges Bank's rate for
 * 24.10.2026 hasn't come in" — and a button that asks for it again before the owner types one. After the answer it
 * says only what the answer says: the rate is in, still isn't, or the function's own error; it never names a reason
 * it was not told (the answer carries counts, not a cause).
 */
export function RateFetch({ day, currency }: { day: string | null | undefined; currency: string }) {
  const fetchAgain = useFetchRatesAgain()
  const when = day ? ` for ${formatDate(day)}` : ''
  const a = fetchAgain.data
  const words = fetchAgain.isError ? null
    : a == null ? `Norges Bank's ${currency} rate${when} hasn't come in.`
      : a.filled > 0 ? `Fetched — the ${currency} rate${when} is in.`
        : `Still no ${currency} rate${when} from Norges Bank.${a.error ? ` ${a.error}` : ''} Type yours below, or try again later.`
  return (
    <div className="flex flex-col items-start gap-2">
      {words && <p className="text-meta text-fg-muted" role="status">{words}</p>}
      <Button size="sm" icon={<RefreshCw />} loading={fetchAgain.isPending} onClick={() => fetchAgain.mutate()}>Fetch again</Button>
    </div>
  )
}
