import { createContext, useContext, useEffect, type RefObject } from 'react'
import type { EntityModalRequest } from './types'

// The popups open right now, oldest first, and how each was opened: an
// entity popup by its request (ids + prefill — it can be opened again), a
// local popup by the element pressed just before it opened (its trigger).
// Dev Requests reads it when a spot inside a popup is picked, so Go there
// can reopen the same popups before it looks for the spot.

export interface PopupStep {
  /** The entity request, when the popup is an entity modal. */
  request: EntityModalRequest | null
  /** The element that opened it (a local popup). */
  opener: Element | null
  /** The popup's panel, once mounted. */
  panel: () => Element | null
}

const open: PopupStep[] = []

/** The open popups, oldest first. */
export const openPopups = (): readonly PopupStep[] => open

/** An entity modal's request, for the ModalShell it renders. */
export const EntityRequestContext = createContext<EntityModalRequest | null>(null)

// The last thing pressed (a tap, a click, or Enter/Space on a focused
// control) — for a popup that opens, that is its trigger.
let lastTrigger: Element | null = null
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', e => { if (e.target instanceof Element) lastTrigger = e.target }, true)
  document.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') lastTrigger = document.activeElement }, true)
}

/** Keeps a ModalShell in the trail while it is open. */
export function usePopupTrail(isOpen: boolean, panel: RefObject<Element | null>) {
  const request = useContext(EntityRequestContext)
  useEffect(() => {
    if (!isOpen) return
    const opener = request || !lastTrigger?.isConnected ? null : lastTrigger
    const step: PopupStep = { request, opener, panel: () => panel.current }
    open.push(step)
    return () => { const i = open.indexOf(step); if (i >= 0) open.splice(i, 1) }
  }, [isOpen, request, panel])
}
