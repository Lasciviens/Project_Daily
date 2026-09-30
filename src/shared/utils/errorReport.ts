import { formatDateTime } from './dateFormat'

/**
 * An error the server described: which action, the HTTP status, and what the
 * provider answered (path, status, a short body — never a token).
 */
export interface ErrorContext { action?: string; httpStatus?: number; detail?: unknown }

export class DetailedError extends Error {
  context: ErrorContext
  constructor(message: string, context: ErrorContext = {}) { super(message); this.context = context }
}

/** The deployed entry bundle's file name (absent in development). */
function buildName(): string {
  const s = typeof document !== 'undefined' ? document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]') : null
  return s?.src.split('/').pop() ?? 'dev'
}

/**
 * A plain-text report to paste into a chat with Claude: where, when, the
 * build, the message and whatever detail the server sent. Nothing secret.
 */
export function errorReport(where: string, err: unknown): string {
  const e = err as Partial<DetailedError> & { message?: string }
  const lines = [
    `Lasci's Board error report`,
    `Where: ${where}`,
    `When: ${formatDateTime(new Date())}`,
    `Page: ${typeof location !== 'undefined' ? location.hash || '/' : '?'}`,
    `Build: ${buildName()}`,
    `Message: ${e?.message ?? String(err)}`,
  ]
  if (e?.context?.action) lines.push(`Server action: ${e.context.action}`)
  if (e?.context?.httpStatus) lines.push(`Server answered: HTTP ${e.context.httpStatus}`)
  if (e?.context?.detail) lines.push(`Detail: ${JSON.stringify(e.context.detail)}`)
  if (typeof navigator !== 'undefined') lines.push(`Browser: ${navigator.userAgent}`)
  return lines.join('\n')
}
