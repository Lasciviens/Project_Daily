import { useState, type ReactNode } from 'react'
import { ChevronRight, Zap } from 'lucide-react'
import { Card, CardHeader, ListRow, PageBoard } from '../../../shared/ui'
import { useQuickGuessPresets } from '../../recipes/hooks/useQuickGuess'
import { QuickGuessEditor } from '../../recipes/components/QuickGuessEditor'
import { FOOD_SETTINGS_BOARD, type FoodSettingsSection } from '../settingsBoards'

// Settings → Food: settings of the Food page. One row so far — Quick guess,
// the presets of Food · Today's Quick guess card (quick_guess_items, migration
// 152), edited in a popup.
export function FoodTab() {
  const [editing, setEditing] = useState(false)
  const { presets, isLoading } = useQuickGuessPresets()
  const summary = isLoading ? 'Loading…'
    : presets.length === 0 ? 'No presets yet'
    : `${presets.length} ${presets.length === 1 ? 'preset' : 'presets'}: ${presets.map(p => p.title).join(', ')}`

  const sections: Record<FoodSettingsSection, ReactNode> = {
    today: (
      <Card>
        <CardHeader title="Food · Today" />
        <ListRow className="-mx-3"
          leading={<span aria-hidden className="grid h-7 w-7 place-items-center rounded-control bg-accent-50 text-accent-600"><Zap className="h-4 w-4" /></span>}
          title="Quick guess" subtitle={summary}
          trailing={<ChevronRight aria-hidden className="h-4 w-4 text-fg-faint" />}
          onClick={() => setEditing(true)} />
      </Card>
    ),
  }
  return (
    <>
      <PageBoard sections={sections} layout={FOOD_SETTINGS_BOARD} stackClassName="max-w-2xl" />
      {editing && <QuickGuessEditor onClose={() => setEditing(false)} />}
    </>
  )
}
