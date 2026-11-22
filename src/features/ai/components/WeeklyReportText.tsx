import { cx } from '../../../shared/ui'
import { reportSections } from '../claude/reportRules'

/**
 * The weekly report's text: the model's own words, drawn as plain text in its headed sections (bold heading lines
 * become headings, the rest paragraphs) — never as HTML, markdown or a link. Used by Home's popup and by the
 * Batches view, so the report reads the same wherever it is opened.
 */
export function WeeklyReportText({ content, className }: { content: string; className?: string }) {
  const sections = reportSections(content)
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {sections.map((s, i) => (
        <section key={`${s.heading}-${i}`} aria-label={s.heading || undefined}>
          {s.heading && <h4 className="section-label mb-1">{s.heading}</h4>}
          <div className="flex flex-col gap-1.5">
            {s.lines.map((line, j) => <p key={j} className="break-words text-body text-fg">{line}</p>)}
          </div>
        </section>
      ))}
    </div>
  )
}
