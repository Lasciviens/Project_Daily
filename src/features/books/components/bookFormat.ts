import type { DeliveryStatus } from '../types'
import type { Tone } from '../../../shared/ui'

export const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  queued: 'Waiting for the Kobo',
  downloaded: 'On the Kobo',
  expired: 'Removed from the inbox',
  cancelled: 'Cancelled',
}

export const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  queued: 'info',
  downloaded: 'success',
  expired: 'neutral',
  cancelled: 'neutral',
}
