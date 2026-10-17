import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { whenHistorySettled } from '../../../shared/hooks/useHistoryDismiss'
import { parseDoseLink } from '../supplementReminder'

/**
 * A reminder's tap lands on `#/recipes?dose=…&day=…&at=…` (push-send): this
 * takes the address back to the page's own, lets the page show the dose's day
 * (`onLink`) and opens the dose sheet once.
 */
export function useDoseLink(onLink?: (date: string) => void) {
  const [params, setParams] = useSearchParams()
  const modal = useEntityModal()
  const target = parseDoseLink(params)
  const key = target ? `${target.date}|${target.scheduleId ?? ''}|${target.time ?? ''}` : null
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (!target || !key || handled.current === key) return
    return whenHistorySettled(() => {
      if (handled.current === key) return
      handled.current = key
      setParams(p => { p.delete('dose'); p.delete('day'); p.delete('at'); return p }, { replace: true })
      onLink?.(target.date)
      modal.open({ kind: 'supplement-dose', date: target.date, scheduleId: target.scheduleId, time: target.time })
    })
    // The key names the target; the rest is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
