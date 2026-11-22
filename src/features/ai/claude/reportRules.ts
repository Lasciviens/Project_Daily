// Pure rules of the weekly report's app side: reading the database's and the function's answers where they enter
// (the report text is the model's, so it is read as plain text and never as markup), splitting the report into its
// headed sections, and what a report row says about itself. No imports but the types: scripts/verify-ai-reports-ui.cjs
// runs it through sucrase.

export type ReportStatus = 'queued' | 'ready' | 'failed'

/** One report as the browser may read it: never `batch_id` or `claimed_at` (the database refuses those columns). */
export interface AiReport {
  id: string
  /** The Monday of the Oslo week it covers, yyyy-MM-dd. */
  week_start: string
  made_by: 'schedule' | 'app'
  status: ReportStatus
  failure: string | null
  /** The report, in English. Null until it is ready. */
  content: string | null
  /** The figures the model was given (shown as a count of sections, never trusted as shapes). */
  facts: Record<string, unknown>
  call_id: string | null
  created_at: string
  ready_at: string | null
  pushed_at: string | null
}

/** The columns the app asks for: the finished ones, by name (select * is refused by the database). */
export const REPORT_COLUMNS = 'id, week_start, made_by, status, failure, content, facts, call_id, created_at, ready_at, pushed_at'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const textOrNull = (v: unknown, max: number): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null)

export function isReportId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function readReport(raw: unknown): AiReport | null {
  const r = rec(raw)
  const status = r.status === 'queued' || r.status === 'ready' || r.status === 'failed' ? r.status : null
  if (!isReportId(r.id) || typeof r.week_start !== 'string' || !DAY.test(r.week_start) || !status) return null
  return {
    id: r.id, week_start: r.week_start, made_by: r.made_by === 'app' ? 'app' : 'schedule', status,
    failure: textOrNull(r.failure, 300), content: status === 'ready' ? textOrNull(r.content, 6000) : null, facts: rec(r.facts),
    call_id: isReportId(r.call_id) ? r.call_id : null, created_at: typeof r.created_at === 'string' ? r.created_at : '',
    ready_at: typeof r.ready_at === 'string' ? r.ready_at : null, pushed_at: typeof r.pushed_at === 'string' ? r.pushed_at : null,
  }
}

export function readReports(raw: unknown): AiReport[] {
  return (Array.isArray(raw) ? raw : []).map(readReport).filter((r): r is AiReport => r !== null)
}

/** The report Home shows: the newest week's newest finished report (ready), or null. */
export function latestReadyReport(reports: readonly AiReport[]): AiReport | null {
  const ready = reports.filter(r => r.status === 'ready' && r.content)
  if (ready.length === 0) return null
  return [...ready].sort((a, b) => b.week_start.localeCompare(a.week_start) || (b.ready_at ?? '').localeCompare(a.ready_at ?? ''))[0]
}

export interface ReportSection {
  /** The heading as written, or '' for text before the first heading. */
  heading: string
  /** Plain paragraphs. */
  lines: string[]
}

/**
 * The report's sections: a line that is only bold text (**Training**) starts one. The text is the model's: every part
 * is returned as plain strings for the screen to draw as text, never as HTML.
 */
export function reportSections(content: string): ReportSection[] {
  const out: ReportSection[] = []
  let current: ReportSection = { heading: '', lines: [] }
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const heading = /^\*\*([^*]{1,40})\*\*$/.exec(line)
    if (heading) {
      if (current.heading || current.lines.length) out.push(current)
      current = { heading: heading[1].trim(), lines: [] }
    } else if (line) current.lines.push(line.replace(/\*\*/g, ''))
  }
  if (current.heading || current.lines.length) out.push(current)
  return out
}

/** The first sentence of the first section with text: what Home's card shows under its title. */
export function reportTeaser(content: string, max = 110): string {
  const first = reportSections(content).find(s => s.lines.length > 0)
  if (!first) return ''
  const sentence = /^[^.!?]*[.!?]/.exec(first.lines[0])?.[0] ?? first.lines[0]
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence
}

/** DD.MM.YYYY, the app's one way to write a date. */
export function reportDay(day: string): string {
  return DAY.test(day) ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : day
}

/** The week a report covers, as the app writes it: "16.11.2026 – 22.11.2026". */
export function reportWeekLabel(weekStart: string): string {
  if (!DAY.test(weekStart)) return weekStart
  const end = new Date(Date.parse(`${weekStart}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)
  return `${reportDay(weekStart)} – ${reportDay(end)}`
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = { queued: 'Waiting', ready: 'Ready', failed: 'Failed' }
export const REPORT_STATUS_TONE: Record<ReportStatus, 'info' | 'success' | 'danger'> = { queued: 'info', ready: 'success', failed: 'danger' }

/** What the "Make this week's report now" button's answer means, in one sentence (the function's own for a stop). */
export function reportMakeMessage(answer: unknown): { ok: boolean; message: string } {
  const a = rec(answer)
  if (a.ok === true && a.queued === true) return { ok: true, message: 'Queued at half price. It is ready within about an hour; Check now reads it back.' }
  if (a.ok === true && a.skipped === 'already_queued') return { ok: false, message: 'This week’s report is already waiting for its answer.' }
  if (a.ok === true && a.skipped === 'no_data') return { ok: false, message: 'There is no data in this week yet, so there is nothing to report.' }
  if (a.ok === true) return { ok: false, message: 'Nothing was queued.' }
  return { ok: false, message: typeof a.message === 'string' && a.message ? a.message.slice(0, 300) : 'The report could not be queued.' }
}

export function reportCheckMessage(answer: unknown): { ok: boolean; message: string } {
  const a = rec(answer)
  if (a.ok !== true) return { ok: false, message: typeof a.message === 'string' && a.message ? a.message.slice(0, 300) : 'The check could not run.' }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (n(a.ready)) return { ok: true, message: 'The report is ready.' }
  if (n(a.failed)) return { ok: true, message: 'The batch ended without a usable report. The row says why.' }
  if (n(a.waiting)) return { ok: true, message: 'Anthropic is still working on it. It is checked again every 15 minutes.' }
  return { ok: true, message: 'Nothing is waiting.' }
}
