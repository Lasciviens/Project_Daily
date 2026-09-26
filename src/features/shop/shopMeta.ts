import type { Tone } from '../../shared/ui'
import type { ShopPriority, ShopRegion } from './types'

// The one enum → tone map for wishlist items (THEME.md §2.4).
export const SHOP_PRIORITY_TONE: Record<ShopPriority, Tone> = {
  low:    'neutral',
  medium: 'warn',
  high:   'danger',
}

export const REGION_FLAG: Record<ShopRegion, string> = { TR: '🇹🇷', NO: '🇳🇴' }
