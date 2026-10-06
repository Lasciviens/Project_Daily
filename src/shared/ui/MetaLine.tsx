import { Fragment, type ReactNode } from 'react'

/**
 * A "a · b · c" meta line that only wraps BETWEEN items: each item (and the
 * dot after it) is unbreakable, so a phone never shows "4g" at the end of one
 * line and "fiber" at the start of the next. Falsy items are skipped.
 * Items are short facts ("518 kcal", "in 1 recipe"); never pass free user
 * text as one item — it can't wrap inside itself.
 */
export function MetaLine({ items, className, as: Tag = 'p' }: {
  items: (ReactNode | false | null | undefined)[]
  className?: string
  as?: 'p' | 'span' | 'div'
}) {
  const shown = items.filter(i => i !== false && i != null && i !== '')
  if (shown.length === 0) return null
  return (
    <Tag className={className}>
      {shown.map((item, i) => (
        <Fragment key={i}>
          <span className="whitespace-nowrap">{item}{i < shown.length - 1 && ' ·'}</span>
          {i < shown.length - 1 && ' '}
        </Fragment>
      ))}
    </Tag>
  )
}
