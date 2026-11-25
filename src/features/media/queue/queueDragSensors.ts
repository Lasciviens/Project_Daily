import { MouseSensor, TouchSensor, useSensor, useSensors, type Modifier } from '@dnd-kit/core'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'
import { clampDragY } from './queueModel'

// Drag and drop for the Queue's rows, on @dnd-kit/core (already the Work
// board's library). A mouse drags once it moves 6px; a finger presses and
// holds 250ms first, so a swipe over the rows still scrolls the page. A press
// on the row's buttons (up, down, ⋯ …) never starts a drag: those keep their
// tap and their long-press description (longPressTips).

const NO_DRAG = '[data-no-drag]'
const fromControl = (target: EventTarget | null) => target instanceof Element && target.closest(NO_DRAG) != null

class RowMouseSensor extends MouseSensor {
  static activators = [{
    eventName: 'onMouseDown' as const,
    handler: (e: ReactMouseEvent, opts: Parameters<typeof MouseSensor.activators[0]['handler']>[1]) =>
      !fromControl(e.nativeEvent.target) && MouseSensor.activators[0].handler(e, opts),
  }]
}

class RowTouchSensor extends TouchSensor {
  static activators = [{
    eventName: 'onTouchStart' as const,
    handler: (e: ReactTouchEvent, opts: Parameters<typeof TouchSensor.activators[0]['handler']>[1]) =>
      !fromControl(e.nativeEvent.target) && TouchSensor.activators[0].handler(e, opts),
  }]
}

export function useQueueDragSensors() {
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
