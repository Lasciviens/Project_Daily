import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { PointReview } from '../devRequestMarks'
import {
  isEmptyPoint, joinWithNext, joinWithPrevious, outlineLabels, parseOutline, pasteText, pointFullText, serializeOutline,
  setLevel, splitPoint, type Caret, type OutlinePoint, type PointLevel,
} from '../outline'
import { pointKeys } from '../pointText'
import { REF_RE } from '../devRequestMarks'
import { focusAtOffset, lastCaret } from './linkedTextDom'
import { OutlineRow, type RowCommand, type RowReview } from './OutlineRow'
import { cx } from '../../../shared/ui'

// The request's text as a numbered outline, written in one box: every point
// is a row with its number (1, 2 … and 1.1, 1.2 … for sub-points), and the
// numbers follow as you type. Enter starts the next point, Shift+Enter a new
// line inside the point, Tab / Shift+Tab make it a sub-point or a point
// again, Backspace at the start of a point outdents it, then joins it to the
// one above. Once the request went to Claude every point also carries its
// Fixed / Not fixed review on the right.
//
// The rows live in local state and the body (outline.ts) is written from
// them; the value is only read back when it changes from outside (a pick
// link put in, another request opened), so the round trip of typing never
// rebuilds a row.

export interface OutlineHandle {
  /** Where the caret is (or last was): point index + offset in its text. */
  caret: () => Caret | null
  focusAt: (c: Caret) => void
  focusEnd: () => void
  /** The focused (or last focused) point becomes a sub-point (1) or a point (-1). */
  indent: (delta: 1 | -1) => void
  /** The element focus should go to when the window opens. */
  focusTarget: () => HTMLElement | null
}

export interface OutlineReview {
  /** The review stored for a point's key (null: none yet). */
  lookup: (key: string) => PointReview | null
  onSet: (key: string, review: Omit<PointReview, 'key'> | null) => void
  onOpenRequest: (id: string) => void
}

interface Row extends OutlinePoint { id: number }

let seq = 0
const withId = (p: OutlinePoint): Row => ({ ...p, id: ++seq })
const parseRows = (value: string): Row[] => {
  const rows = parseOutline(value, { keepEmpty: true }).map(withId)
  return rows.length ? rows : [withId({ level: 0, text: '', tail: null })]
}

interface Props {
  value: string
  onChange: (value: string) => void
  labelOf: (id: string) => string
  onOpenLink: (id: string) => void
  review?: OutlineReview
  handleRef?: Ref<OutlineHandle>
  placeholder: string
  ariaLabel: string
  className?: string
  /** The box glows briefly (a pick was just put in). */
  flash?: boolean
}

export function OutlineEditor({ value, onChange, labelOf, onOpenLink, review, handleRef, placeholder, ariaLabel, className, flash }: Props) {
  const [rows, setRows] = useState<Row[]>(() => parseRows(value))
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    // Changed from outside: read it again.
    setSynced(value)
    setRows(parseRows(value))
  }
  const rowsRef = useRef(rows)
  const els = useRef(new Map<number, HTMLDivElement>())
  const pending = useRef<{ id: number; offset: number } | null>(null)
  const last = useRef<{ id: number; offset: number } | null>(null)
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => { rowsRef.current = rows; onChangeRef.current = onChange })

  const commit = useCallback((next: Row[], focus?: Caret) => {
    rowsRef.current = next
    setRows(next)
    const body = serializeOutline(next)
    setSynced(body)
    onChangeRef.current(body)
    if (focus) {
      const row = next[Math.max(0, Math.min(focus.index, next.length - 1))]
      if (row) { pending.current = { id: row.id, offset: focus.offset }; last.current = pending.current }
    }
  }, [])

  // Focus moves after the rows have rendered their new text.
  useLayoutEffect(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    focusAtOffset(els.current.get(p.id) ?? null, p.offset)
  })

  const indexOf = (id: number) => rowsRef.current.findIndex(r => r.id === id)
  const register = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) els.current.set(id, el)
    else els.current.delete(id)
  }, [])

  const onText = useCallback((id: number, text: string, caret: number) => {
    last.current = { id, offset: caret }
    commit(rowsRef.current.map(r => (r.id === id ? { ...r, text } : r)))
  }, [commit])

  const onFocusRow = useCallback((id: number) => {
    const el = els.current.get(id)
    last.current = { id, offset: el ? lastCaret.get(el) ?? 0 : 0 }
  }, [])

  const shift = useCallback((index: number, level: PointLevel, offset: number) => {
    const cur = rowsRef.current
    if (!cur[index] || cur[index].level === level) { pending.current = { id: cur[index]?.id ?? 0, offset }; setRows([...cur]); return }
    commit(setLevel(cur, index, level), { index, offset })
  }, [commit])

  const onCommand = useCallback((id: number, cmd: RowCommand, [a, b]: [number, number]) => {
    const cur = rowsRef.current
    const i = cur.findIndex(r => r.id === id)
    if (i < 0) return
    const go = (index: number, offset: 'start' | 'end') => {
      const row = cur[index]
      if (!row) return
      focusAtOffset(els.current.get(row.id) ?? null, offset === 'start' ? 0 : row.text.length)
    }
    switch (cmd) {
      case 'enter': { const r = splitPoint(cur, i, a, b, withId); commit(r.points, r.caret); return }
      case 'backspace-start': { const r = joinWithPrevious(cur, i); if (r) commit(r.points, r.caret); else if (i > 0) go(i - 1, 'end'); return }
      case 'delete-end': { const r = joinWithNext(cur, i); if (r) commit(r.points, r.caret); return }
      case 'indent': shift(i, 1, a); return
      case 'outdent': shift(i, 0, a); return
      case 'up': case 'left': go(i - 1, 'end'); return
      case 'down': case 'right': go(i + 1, 'start'); return
    }
  }, [commit, shift])

  const onPaste = useCallback((id: number, text: string, [a, b]: [number, number]) => {
    const cur = rowsRef.current
    const i = cur.findIndex(r => r.id === id)
    if (i < 0) return
    const r = pasteText(cur, i, a, b, text, withId)
    commit(r.points, r.caret)
  }, [commit])

  useImperativeHandle(handleRef, () => ({
    caret: () => {
      const l = last.current
      const i = l ? indexOf(l.id) : -1
      if (!l || i < 0) return null
      // The point remembers its caret on every key and click (linkedTextDom.lastCaret).
      const el = els.current.get(l.id)
      return { index: i, offset: (el && lastCaret.get(el)) ?? l.offset }
    },
    focusAt: (c) => {
      const row = rowsRef.current[Math.max(0, Math.min(c.index, rowsRef.current.length - 1))]
      if (row) focusAtOffset(els.current.get(row.id) ?? null, c.offset)
    },
    focusEnd: () => {
      const row = rowsRef.current[rowsRef.current.length - 1]
      if (row) focusAtOffset(els.current.get(row.id) ?? null, row.text.length)
    },
    indent: (delta) => {
      const l = last.current
      const i = l ? indexOf(l.id) : -1
      if (i < 0) return
      const el = els.current.get(l!.id)
      shift(i, delta === 1 ? 1 : 0, (el && lastCaret.get(el)) ?? l!.offset)
    },
    focusTarget: () => {
      const row = rowsRef.current[rowsRef.current.length - 1]
      return row ? els.current.get(row.id) ?? null : null
    },
  }), [shift])

  const labels = useMemo(() => outlineLabels(rows), [rows])
  // A point is known by a hash of its words (pointText.ts), so the review
  // found here is the one the saved request holds for the same words.
  const keys = useMemo(() => {
    const filled = rows.filter(r => !isEmptyPoint(r))
    const k = pointKeys(filled.map(pointFullText))
    const byId = new Map(filled.map((r, i) => [r.id, k[i]] as const))
    return rows.map(r => byId.get(r.id) ?? null)
  }, [rows])
  const labelKey = useMemo(() => Array.from(value.matchAll(REF_RE), m => `${m[1]}=${labelOf(m[1])}`).join('|'), [value, labelOf])
  const only = rows.length === 1 && isEmptyPoint(rows[0])

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onMouseDown={e => {
        // A click on the box's empty space below the points goes to the last one.
        if (e.target === e.currentTarget) { e.preventDefault(); const row = rows[rows.length - 1]; focusAtOffset(els.current.get(row.id) ?? null, row.text.length) }
      }}
      className={cx(
        'flex cursor-text flex-col gap-0.5 rounded-input border border-line bg-surface p-1.5 transition-[border-color,box-shadow] duration-100',
        'focus-within:border-accent-500 focus-within:shadow-[0_0_0_3px_rgb(var(--accent-500)/0.18)]',
        flash && 'border-accent-500 shadow-[0_0_0_3px_rgb(var(--accent-500)/0.18)]',
        className,
      )}
    >
      {rows.map((r, i) => {
        const key = keys[i]
        const rowReview: RowReview | undefined = review && key ? {
          review: review.lookup(key),
          onSet: rv => review.onSet(key, rv),
          onOpenRequest: review.onOpenRequest,
        } : undefined
        return (
          <OutlineRow
            key={r.id}
            id={r.id}
            level={i === 0 ? 0 : r.level}
            label={labels[i]}
            text={r.text}
            tail={r.tail}
            placeholder={only ? placeholder : r.level === 1 ? 'Sub-point' : 'Point'}
            alwaysPlaceholder={only}
            labelOf={labelOf}
            labelKey={labelKey}
            ariaLabel={`Point ${labels[i]}`}
            review={rowReview}
            onText={onText}
            onCommand={onCommand}
            onPaste={onPaste}
            onFocusRow={onFocusRow}
            onOpenLink={onOpenLink}
            register={register}
          />
        )
      })}
    </div>
  )
}
