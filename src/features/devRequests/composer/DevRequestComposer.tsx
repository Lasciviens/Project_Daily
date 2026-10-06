import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { cleanText, type Capture } from '../devRequestContext'
import { draftFromRow, isDraftEmpty, type ComposerTarget } from '../devRequestRules'
import { useDevRequests } from '../hooks/useDevRequests'
import { usePageContextReader } from '../pick/usePageContext'
import { usePickMode, type PickModeKind } from '../pick/usePickMode'
import { labelFor, readElement, readPopupTrail } from '../pick/pickDom'
import { PickHighlight } from '../pick/PickHighlight'
import { insertPickAt } from '../devRequestMarks'
import type { Caret } from '../outline'
import type { OutlineHandle } from '../components/OutlineEditor'
import { ComposerRequestView } from './ComposerRequestView'
import { ComposerPromptView } from './ComposerPromptView'
import { ABOVE_TABBAR, COMPOSER_ROOT, ComposerHeader, ComposerPill, PickBar, PickingBanner } from './ComposerFrame'
import { focusIntoComposer, useMediaQuery, useSelectionSnapshot } from './composerHooks'
import { useFloatingWindow } from '../../../shared/hooks/useFloatingWindow'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useKeyboardInset } from '../../../shared/hooks/useKeyboardInset'
import { useUIStore } from '../../../app/store'
import { cx } from '../../../shared/ui'

// The last focus request acted on. Module-level, so a request made while the
// composer was tucked away (or not yet loaded) is still honoured once it
// shows, and a reload (store counter back at 0) never grabs focus.
let handledFocus = 0

const sameTarget = (a: ComposerTarget, b: ComposerTarget) => a.kind === b.kind && (a.kind === 'new' || (b.kind === 'edit' && a.id === b.id))

/**
 * The floating request window: one request (new, or an edit of an existing
 * one) written in a window that stays on screen while you move around the
 * app — or, as its own step, the prompt for Claude (mode 'prompt', opened by
 * Build prompt in the Requests list, with Back to the request). Draggable on tablet/desktop, docked above
 * the tab bar on phones, minimisable to a pill. While it is open you can
 * point at things on the page (Pick on page, or Alt-click with a mouse): each
 * pick becomes a link in the text where the caret was ("Water card"; a click
 * opens the spot), and its full technical detail waits, out of sight, for the
 * prompt for Claude.
 */
export function DevRequestComposer() {
  const composer = useDevRequestDrafts(s => s.composer)
  const newDraft = useDevRequestDrafts(s => s.newDraft)
  const editDrafts = useDevRequestDrafts(s => s.editDrafts)
  const promptEdited = useDevRequestDrafts(s => s.prompt.edited)
  const focusReq = useDevRequestDrafts(s => s.focus)
  const store = useDevRequestDrafts.getState
  const phone = useBreakpoint() === 'phone'
  // Touch tablets pick in two steps like phones (a fingertip rarely lands on
  // the right box, and there are no arrow keys for "wider"); the Alt-click
  // hint only makes sense with a mouse.
  const coarse = useMediaQuery('(pointer: coarse)')
  const mouse = useMediaQuery('(hover: hover) and (pointer: fine)')
  const twoStep = phone || coarse
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
  const rootRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const outlineRef = useRef<OutlineHandle | null>(null)
  // Where the caret was in the text when picking started (the phone swaps
  // the composer for the pick bar, so the text box is gone meanwhile).
  const caretAtPick = useRef<Caret | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const selection = useSelectionSnapshot(!composer.minimized && composer.tab === 'request' && !picking)

  const capture = useCallback((el: Element | null, quote?: string) => {
    if (!canWrite) return
    const page = readPage()
    const capture: Capture | null = quote
      ? { kind: 'selection', page, quote, element: el ? readElement(el) : null, popups: el ? readPopupTrail(el) : [] }
      : el ? { kind: 'element', page, element: readElement(el), popups: readPopupTrail(el) } : null
    if (!capture) return
    const at = outlineRef.current?.caret() ?? caretAtPick.current
    caretAtPick.current = null
    let caret: Caret = { index: 0, offset: 0 }
    store().editDescription(target, d => { const r = insertPickAt(d, capture, at); caret = r.caret; return r.text }, seed)
    store().setComposerTab('request')
    setFlash(true)
    // Carry on typing right after the link (once the editor is back).
    setTimeout(() => outlineRef.current?.focusAt(caret), 60)
  }, [canWrite, readPage, store, target, seed])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(false), 700); return () => clearTimeout(t) }, [flash])

  const stopPicking = useCallback(() => { setPicking(false); setCandidate(null) }, [])
  const mode: PickModeKind = composer.minimized || tucked || !canWrite ? 'off' : picking ? 'pick' : phone ? 'off' : 'alt'
  const pick = usePickMode({
    mode, twoStep,
    onCapture: el => { capture(el); stopPicking() },
    onCandidate: setCandidate,
    onCancel: stopPicking,
    boxRef, labelRef,
  })
  const startPicking = () => { caretAtPick.current = outlineRef.current?.caret() ?? null; store().setComposerTab('request'); setCandidate(null); setPicking(true) }

  const { setWindowEl, handleProps, resetPosition } = useFloatingWindow({
    enabled: !phone && !composer.minimized && !tucked,
    position: composer.pos,
    onCommit: useCallback((p: { x: number; y: number }) => store().setComposerPos(p), [store]),
  })
  const setRoot = useCallback((el: HTMLDivElement | null) => { rootRef.current = el; setWindowEl(el) }, [setWindowEl])

  // Focus follows the actions that ask for it (store.focus): opening or
  // restoring puts it in the first empty field (title, else details; the
  // prompt on its tab), minimising puts it on the pill. A request counts as
  // handled once that is done — one cut short (unmounted, tucked away, the
  // dev-mode double effect) is picked up again on the next run.
  useEffect(() => {
    const n = focusReq.n
    if (n === 0 || n === handledFocus || tucked) return
    if (focusReq.to === 'pill' ? !composer.minimized : composer.minimized) return
    const prev = handledFocus
    let finished = false
    handledFocus = n
    const release = () => { if (!finished && handledFocus === n) handledFocus = prev }
    if (focusReq.to === 'pill') {
      const raf = requestAnimationFrame(() => { finished = true; pillRef.current?.focus({ preventScroll: true }) })
      return () => { cancelAnimationFrame(raf); release() }
    }
    const cancel = focusIntoComposer(
      () => rootRef.current,
      () => (store().composer.tab === 'prompt' ? promptRef.current
        : titleRef.current && !titleRef.current.value.trim() ? titleRef.current : outlineRef.current?.focusTarget() ?? titleRef.current),
      () => { finished = true },
    )
    return () => { cancel(); release() }
  }, [focusReq, tucked, composer.minimized, store])

  // Double-click the title bar: back to the corner.
  const dragProps = { ...handleProps, onDoubleClick: () => { resetPosition(); store().setComposerPos(null) } }

  const dirty = target.kind === 'new' ? !isDraftEmpty(newDraft) : target.id in editDrafts
  const title = composer.tab === 'prompt' ? 'Prompt for Claude' : target.kind === 'new' ? 'New request' : 'Edit request'
  const close = () => { stopPicking(); store().closeComposer() }
  // A save can finish after the composer moved on (minimised, or switched to
  // another request): only close it while it still shows what was saved.
  const onSaved = (saved: ComposerTarget) => { const c = store().composer; if (c.open && sameTarget(c.target, saved)) close() }
  const minimize = () => { stopPicking(); store().setMinimized(true) }
  // Esc minimises (never a popup underneath); picking handles its own Esc.
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picking) { e.stopPropagation(); minimize() } }

  if (tucked) return null
  if (composer.minimized) {
    const label = composer.tab === 'prompt' ? 'Prompt for Claude'
      : cleanText(target.kind === 'new' ? newDraft.title || 'New request' : row?.title || 'Edit request', 40)
    return <ComposerPill pillRef={pillRef} label={label} prompt={composer.tab === 'prompt'} dirty={dirty || promptEdited} phone={phone} onOpen={() => store().setMinimized(false)} />
  }

  const body = composer.tab === 'request'
    ? (
      <ComposerRequestView
        target={target}
        readPage={readPage}
        onPick={startPicking}
        onQuote={selection ? () => { capture(selection.element, selection.text); selection.clear() } : null}
        mouse={!phone && mouse}
        flash={flash}
        titleRef={titleRef}
        outlineRef={outlineRef}
        onDone={onSaved}
        onDeleted={close}
      />
    )
    : <ComposerPromptView textareaRef={promptRef} />
  // Back from the prompt to the request being written (there is always one: new or an edit).
  const back = composer.tab === 'prompt' ? () => store().setComposerTab('request') : undefined
  const highlight = <PickHighlight boxRef={boxRef} labelRef={labelRef} />
  const pickBar = (docked: boolean) => (
    <PickBar
      docked={docked}
      label={candidate ? labelFor(candidate) : null}
      onWider={() => pick.current.widen()}
      onUse={() => { if (candidate) capture(candidate); stopPicking() }}
      onCancel={stopPicking}
    />
  )

  if (phone) {
    if (picking) return <>{highlight}{pickBar(true)}</>
    const maxHeight = keyboard > 0
      ? `calc(100dvh - ${keyboard}px - env(safe-area-inset-top) - 8px)`
      : 'min(62dvh, calc(100dvh - var(--app-header-h) - env(safe-area-inset-top) - var(--app-tabbar-h) - env(safe-area-inset-bottom) - 16px))'
    return (
      <div
        ref={rootRef}
        data-dev-request-ui=""
        role="region"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ bottom: keyboard > 0 ? `${keyboard}px` : ABOVE_TABBAR, maxHeight, height: composer.tab === 'prompt' ? maxHeight : undefined }}
        className={cx(COMPOSER_ROOT, 'fixed inset-x-0 z-chrome flex flex-col overflow-hidden rounded-t-sheet border-x border-t border-line-strong bg-surface shadow-menu outline-none')}
      >
        <ComposerHeader title={title} phone onBack={back} onMinimize={minimize} onClose={close} />
        {body}
      </div>
    )
  }

  return (
    <>
      {highlight}
      <div
        ref={setRoot}
        data-dev-request-ui=""
        role="region"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={WINDOW_STYLE}
        className={cx(
          COMPOSER_ROOT,
          'fixed z-float flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-menu outline-none',
          composer.tab === 'prompt' ? 'h-[min(40rem,calc(100dvh-16px))] w-[34rem]' : 'max-h-[min(44rem,calc(100dvh-16px))] w-[30rem]',
          picking && 'ring-2 ring-accent-500/40',
        )}
      >
        <ComposerHeader title={title} phone={false} onBack={back} onMinimize={minimize} onClose={close} dragProps={dragProps} />
        {picking && (twoStep ? pickBar(false) : <PickingBanner onStop={stopPicking} />)}
        {body}
      </div>
    </>
  )
}

// Constant so React never re-applies it over the position useFloatingWindow writes.
const WINDOW_STYLE = { left: 0, top: 0, visibility: 'hidden' } as const
