import { MouseSensor, TouchSensor, useSensor, useSensors, type Modifier } from '@dnd-kit/core'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'
import { clampDragY } from './dragReorderModel'

// How a drag starts, on @dnd-kit/core (already the Work board's library). A
// mouse drags once it moves 6px, so a click is still a click; a finger presses
// and holds 250ms first, so a swipe over the rows still scrolls the page. No
// PointerSensor: it answers touch too and would start a drag on a swipe.
//
// A press never starts a drag on a row's own controls (anything inside
// `data-no-drag`: they keep their tap and their long-press description) nor
// from a popup opened from the row (a menu in a portal: React passes its
// events up to the row, but it isn't inside the row on the page).

export const NO_DRAG_ATTR = 'data-no-drag'

function notDraggable(e: ReactMouseEvent | ReactTouchEvent): boolean {
  const target = e.nativeEvent.target
  if (!(target instanceof Element)) return true
  return target.closest(`[${NO_DRAG_ATTR}]`) != null || !(e.currentTarget as Element).contains(target)
}

class RowMouseSensor extends MouseSensor {
  static activators = [{
    eventName: 'onMouseDown' as const,
    handler: (e: ReactMouseEvent, opts: Parameters<typeof MouseSensor.activators[0]['handler']>[1]) =>
      !notDraggable(e) && MouseSensor.activators[0].handler(e, opts),
  }]
}

class RowTouchSensor extends TouchSensor {
  static activators = [{
    eventName: 'onTouchStart' as const,
    handler: (e: ReactTouchEvent, opts: Parameters<typeof TouchSensor.activators[0]['handler']>[1]) =>
      !notDraggable(e) && TouchSensor.activators[0].handler(e, opts),
  }]
}

export function useDragReorderSensors() {
  return useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  )
}

/**
 * A row moves only up and down, and never past the list's ends: a row dragged
 * beyond them made the page taller, so the edge auto-scroll ran on into empty
 * space.
 */
export const withinList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => ({
  ...transform,
  x: 0,
  y: draggingNodeRect && containerNodeRect ? clampDragY(transform.y, draggingNodeRect, containerNodeRect) : transform.y,
})

/**
 * The page scrolls under the pointer only in the outer 12% of the scroll area
 * (dnd-kit's 20% took a fifth of a sideways phone: moving the top row two
 * places down scrolled the page).
 */
export const EDGE_SCROLL = { threshold: { x: 0, y: 0.12 } } as const
