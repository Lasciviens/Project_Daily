import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { cleanText, formatCapture } from '../devRequestContext'
import { draftFromRow, isDraftEmpty } from '../devRequestRules'
import { useDevRequests } from '../hooks/useDevRequests'
import { usePageContextReader } from '../pick/usePageContext'
import { usePickMode, type PickModeKind } from '../pick/usePickMode'
import { labelFor, readElement, readSelection } from '../pick/pickDom'
import { PickHighlight } from '../pick/PickHighlight'
import { ComposerRequestTab } from './ComposerRequestTab'
import { ComposerPromptTab } from './ComposerPromptTab'
import { ABOVE_TABBAR, ComposerHeader, ComposerPill, ComposerTabs, PhonePickBar, PickingBanner } from './ComposerFrame'
import { useFloatingWindow } from '../../../shared/hooks/useFloatingWindow'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useKeyboardInset } from '../../../shared/hooks/useKeyboardInset'
import { useUIStore } from '../../../app/store'
import { cx } from '../../../shared/ui'

/**
 * The floating request composer: one request (new, or an edit of an existing
 * one) written in a window that stays on screen while you move around the
 * app, plus the prompt for Claude. Draggable on tablet/desktop, docked above
 * the tab bar on phones, minimisable to a pill. While it is open you can
 * point at things on the page (Pick on page, or Alt-click on desktop): each
 * pick appends a plain-text block to the description saying exactly what
 * and where it is.
 */
export function DevRequestComposer() {
  const composer = useDevRequestDrafts(s => s.composer)
  const newDraft = useDevRequestDrafts(s => s.newDraft)
  const editDrafts = useDevRequestDrafts(s => s.editDrafts)
  const promptEdited = useDevRequestDrafts(s => s.prompt.edited)
  const store = useDevRequestDrafts.getState
  const phone = useBreakpoint() === 'phone'
  // A right-edge drawer (Requests, Ask AI) tucks the window away until it
  // closes — it would cover the drawer's own controls. Phones: the drawer is
  // a sheet over the docked composer anyway.
  const tucked = useUIStore(s => s.isDevRequestsOpen || s.isAIOpen) && !phone
  const keyboard = useKeyboardInset()
  const readPage = usePageContextReader()
  const { data: requests } = useDevRequests()
  const target = composer.target
  const row = target.kind === 'edit' ? requests?.find(r => r.id === target.id) ?? null : null
  const seed = useMemo(() => (row ? draftFromRow(row) : undefined), [row])
  const canWrite = target.kind === 'new' || !!row

  const [picking, setPicking] = useState(false)
  const [candidate, setCandidate] = useState<Element | null>(null)
  const [flash, setFlash] = useState(false)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const selection = useSelectionSnapshot(!composer.minimized && composer.tab === 'request' && !picking)

  const capture = useCallback((el: Element | null, quote?: string) => {
    if (!canWrite) return
    const page = readPage()
    const block = quote
      ? formatCapture({ kind: 'selection', page, quote, element: el ? readElement(el) : null })
      : el ? formatCapture({ kind: 'element', page, element: readElement(el) }) : ''
    if (!block) return
    store().appendToDescription(target, block, seed)
    store().setComposerTab('request')
    setFlash(true)
    requestAnimationFrame(() => { const d = descRef.current; if (d) d.scrollTop = d.scrollHeight })
  }, [canWrite, readPage, store, target, seed])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(false), 700); return () => clearTimeout(t) }, [flash])

  const stopPicking = useCallback(() => { setPicking(false); setCandidate(null) }, [])
  const mode: PickModeKind = composer.minimized || tucked || !canWrite ? 'off' : picking ? 'pick' : phone ? 'off' : 'alt'
  const pick = usePickMode({
    mode, twoStep: phone,
    onCapture: el => { capture(el); stopPicking() },
    onCandidate: setCandidate,
    onCancel: stopPicking,
    boxRef, labelRef,
  })
  const startPicking = () => { store().setComposerTab('request'); setCandidate(null); setPicking(true) }

  const { setWindowEl, handleProps, resetPosition } = useFloatingWindow({
    enabled: !phone && !composer.minimized && !tucked,
    position: composer.pos,
    onCommit: useCallback((p: { x: number; y: number }) => store().setComposerPos(p), [store]),
  })

  // Double-click the title bar: back to the corner.
  const dragProps = { ...handleProps, onDoubleClick: () => { resetPosition(); store().setComposerPos(null) } }

  const dirty = target.kind === 'new' ? !isDraftEmpty(newDraft) : target.id in editDrafts
  const marker = composer.tab === 'prompt' ? (promptEdited ? 'Edited' : null) : dirty ? 'Unsaved' : null
  const title = composer.tab === 'prompt' ? 'Prompt for Claude' : target.kind === 'new' ? 'New request' : 'Edit request'
  const close = () => { stopPicking(); store().closeComposer() }
  const minimize = () => { stopPicking(); store().setMinimized(true) }
  // Esc minimises (never a popup underneath); picking handles its own Esc.
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picking) { e.stopPropagation(); minimize() } }

  if (tucked) return null
  if (composer.minimized) {
    const label = composer.tab === 'prompt' ? 'Prompt for Claude'
      : cleanText(target.kind === 'new' ? newDraft.title || 'New request' : row?.title || 'Edit request', 40)
    return <ComposerPill label={label} prompt={composer.tab === 'prompt'} dirty={dirty || promptEdited} phone={phone} onOpen={() => store().setMinimized(false)} />
  }

  const body = (
    <>
      <ComposerTabs tab={composer.tab} onChange={t => { stopPicking(); store().setComposerTab(t) }} />
      {composer.tab === 'request'
        ? (
          <ComposerRequestTab
            target={target}
            readPage={readPage}
            onPick={startPicking}
            onQuote={selection ? () => { capture(selection.element, selection.text); selection.clear() } : null}
            altHint={!phone}
            flash={flash}
            descriptionRef={descRef}
            onDone={close}
          />
        )
        : <ComposerPromptTab />}
    </>
  )
  const highlight = <PickHighlight boxRef={boxRef} labelRef={labelRef} />

  if (phone) {
    if (picking) {
      return (
        <>
          {highlight}
          <PhonePickBar
            label={candidate ? labelFor(candidate) : null}
            onWider={() => pick.current.widen()}
            onUse={() => { if (candidate) capture(candidate); stopPicking() }}
            onCancel={stopPicking}
          />
        </>
      )
    }
    const maxHeight = keyboard > 0
      ? `calc(100dvh - ${keyboard}px - env(safe-area-inset-top) - 8px)`
      : 'min(62dvh, calc(100dvh - var(--app-header-h) - env(safe-area-inset-top) - var(--app-tabbar-h) - env(safe-area-inset-bottom) - 16px))'
    return (
      <div
        data-dev-request-ui=""
        role="dialog"
        aria-modal="false"
        aria-label={title}
        onKeyDown={onKeyDown}
        style={{ bottom: keyboard > 0 ? `${keyboard}px` : ABOVE_TABBAR, maxHeight }}
        className="fixed inset-x-0 z-chrome flex flex-col overflow-hidden rounded-t-sheet border-x border-t border-line-strong bg-surface shadow-menu"
      >
        <ComposerHeader title={title} dirty={marker} phone onMinimize={minimize} onClose={close} />
        {body}
      </div>
    )
  }

  return (
    <>
      {highlight}
      <div
        ref={setWindowEl}
        data-dev-request-ui=""
        role="dialog"
        aria-modal="false"
        aria-label={title}
        onKeyDown={onKeyDown}
        style={WINDOW_STYLE}
        className={cx(
          'fixed z-float flex w-[26rem] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-menu',
          'max-h-[min(40rem,calc(100dvh-16px))]',
          picking && 'ring-2 ring-accent-500/40',
        )}
      >
        <ComposerHeader title={title} dirty={marker} phone={false} onMinimize={minimize} onClose={close} dragProps={dragProps} />
        {picking && <PickingBanner onStop={stopPicking} />}
        {body}
      </div>
    </>
  )
}

// Constant so React never re-applies it over the position useFloatingWindow writes.
const WINDOW_STYLE = { left: 0, top: 0, visibility: 'hidden' } as const

/**
 * The last text the user selected on the page (outside the composer), kept
 * for a few seconds after it is cleared — on a phone, tapping the Quote
 * button clears the selection before the tap lands.
 */
function useSelectionSnapshot(enabled: boolean) {
  const [snap, setSnap] = useState<{ text: string; element: Element } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      const s = readSelection()
      if (s) {
        clearTimeout(timer)
        setSnap(prev => (prev && prev.text === s.text && prev.element === s.element ? prev : s))
      } else {
        clearTimeout(timer)
        timer = setTimeout(() => setSnap(null), 8000)
      }
    }
    onChange()
    document.addEventListener('selectionchange', onChange)
    return () => { document.removeEventListener('selectionchange', onChange); clearTimeout(timer) }
  }, [enabled])
  return snap ? { ...snap, clear: () => setSnap(null) } : null
}
