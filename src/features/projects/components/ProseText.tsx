import { Fragment } from 'react'
import { cx } from '../../../shared/ui'
import { parseInline, parseProse } from '../proseModel'

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.kind === 'code' ? <code key={i} className="rounded bg-surface-2 px-1 font-mono">{p.text}</code>
        : p.kind === 'bold' ? <strong key={i} className="font-semibold text-fg">{p.text}</strong>
        : p.kind === 'link' ? <a key={i} href={p.url} target="_blank" rel="noreferrer noopener" className="break-words font-medium text-accent-600 underline-offset-2 hover:underline">{p.text}</a>
        : <Fragment key={i}>{p.text}</Fragment>)}
    </>
  )
}

/** A page's or an entry's text: headings, lists, code and links (proseModel), never raw HTML. */
export function ProseText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2 text-body text-fg-2', className)}>
      {parseProse(text).map((part, i) => {
        switch (part.kind) {
          case 'heading':
            return part.level === 1
              ? <h4 key={i} className="mt-1 text-lead font-semibold text-fg"><Inline text={part.text} /></h4>
              : <h5 key={i} className="mt-1 text-ui text-fg"><Inline text={part.text} /></h5>
          case 'bullets':
            return <ul key={i} className="ml-4 list-disc space-y-0.5">{part.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ul>
          case 'steps':
            return <ol key={i} className="ml-5 list-decimal space-y-0.5">{part.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</ol>
          case 'code':
            return <pre key={i} className="scroll-x overflow-x-auto rounded-row bg-surface-2 px-3 py-2 font-mono text-meta leading-relaxed text-fg-2">{part.text}</pre>
          default:
            return <p key={i} className="whitespace-pre-line break-words"><Inline text={part.text} /></p>
        }
      })}
    </div>
  )
}
