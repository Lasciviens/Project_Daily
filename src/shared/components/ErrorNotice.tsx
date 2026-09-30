import { AlertTriangle, ClipboardCopy, RefreshCw } from 'lucide-react'
import { toast } from '../../app/store'
import { Button } from '../ui'
import { errorReport } from '../utils/errorReport'

/**
 * A failure shown in place: what went wrong in plain words, Try again, and
 * "Copy details" — a report (where, when, build, what the server answered) to
 * paste to Claude so it can be investigated.
 */
export function ErrorNotice({ where, error, onRetry, title }: { where: string; error: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof Error ? error.message : String(error)
  async function copy() {
    try {
      await navigator.clipboard.writeText(errorReport(where, error))
      toast.success('Details copied — paste them to Claude')
    } catch {
      toast.error('Could not copy — your browser blocked the clipboard')
    }
  }
  return (
    <div role="alert" data-tone="danger" className="tone-soft flex w-full max-w-2xl flex-col gap-2 rounded-row p-3">
      <p className="flex items-start gap-2 text-body text-fg">
        <AlertTriangle aria-hidden className="tone-text mt-0.5 h-4 w-4 shrink-0" />
        <span><span className="font-semibold">{title ?? 'Something went wrong.'}</span> {message}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {onRetry && <Button size="sm" icon={<RefreshCw />} onClick={onRetry}>Try again</Button>}
        <Button size="sm" variant="ghost" icon={<ClipboardCopy />} onClick={() => { void copy() }}>Copy details</Button>
      </div>
    </div>
  )
}
