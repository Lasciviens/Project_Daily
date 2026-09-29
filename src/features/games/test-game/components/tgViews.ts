import { LayoutGrid, LayoutPanelLeft, List, type LucideIcon } from 'lucide-react'
import type { TgView } from '../testGameModel'

/** The three library views (also offered in the ⋯ menu when the toolbar is too narrow for this switch). */
export const TG_VIEWS: { key: TgView; label: string; menuLabel: string; icon: LucideIcon }[] = [
  { key: 'shelf', label: 'Shelf view', menuLabel: 'Shelf', icon: LayoutGrid },
  { key: 'grid', label: 'Cover grid view', menuLabel: 'Cover grid', icon: LayoutPanelLeft },
  { key: 'list', label: 'List view', menuLabel: 'List', icon: List },
]
