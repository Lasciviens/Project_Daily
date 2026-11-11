import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { MoreHorizontal, Pencil, Power, RotateCcw } from 'lucide-react'
import { MetaLine, TonePill, Truncate, cx } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useEditStoreRule, useResetStoreRule } from '../../hooks/useShopStores'
import { ruleName, sourceConflict, sourceWords, unchecked } from '../../storeRules'
import { ruleFacts, ruleOrigin, ruleTitle } from '../../storeWords'
import { SourceLink } from '../purchase/purchaseKit'
import type { ShopStore, ShopStoreRule } from '../../types'

/**
 * One rule of a store: its name and facts, where they come from (its source, link and read date — "you edited
 * it" or "from Ask AI — check it"), the store's own words, and — when the owner's edit and its source now say
 * different things — the conflict, shown and never picked. ⋯ Edit · Reset to its source · Turn off (a seeded rule
 * is never deleted: the next seed would bring it back).
 */
export function RuleRow({ rule, store, stores, onEdit }: { rule: ShopStoreRule; store: ShopStore; stores: readonly ShopStore[]; onEdit: () => void }) {
  const edit = useEditStoreRule()
  const reset = useResetStoreRule()
  const origin = ruleOrigin(rule)
  const conflict = sourceConflict(rule)
  const canReset = rule.owner_edited && rule.source !== null
  const name = ruleName(rule, store)
  const source = [
    // Ask AI's or a price site's label is the pill; its line says when it was read, as any other's.
    unchecked(rule) ? (rule.read_on ? `read ${formatDate(rule.read_on)}` : 'not read') : sourceWords(rule),
    rule.owner_edited && rule.source?.read_on ? `its source read ${formatDate(rule.source.read_on)}` : null,
  ].filter((x): x is string => !!x)
  const link = rule.source_url ?? rule.source?.source_url ?? null

  return (
    <li className={cx('flex flex-col gap-1 rounded-row border border-line bg-surface px-2.5 py-2', rule.off && 'bg-surface-2')}>
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <Truncate as="p" className={cx('text-body font-medium', rule.off ? 'text-fg-muted line-through decoration-fg-faint' : 'text-fg')}>{ruleTitle(rule)}</Truncate>
          <MetaLine as="p" className="text-meta tabular-nums text-fg-muted" items={ruleFacts(rule, stores)} />
        </div>
        {rule.off ? <TonePill tone="neutral" className="mt-0.5 shrink-0">Off</TonePill> : origin.tone !== 'neutral' && <TonePill tone={origin.tone} className="mt-0.5 shrink-0">{origin.words}</TonePill>}
        <Menu as="div" className="shrink-0">
          <MenuButton className="icon-btn h-8 w-8 text-fg-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Rule actions: ${name}`} title="Edit, reset or turn off">
            <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
          </MenuButton>
          <MenuItems anchor="bottom end" transition className="menu z-toast w-56 [--anchor-gap:4px] transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0">
            <MenuItem><button type="button" onClick={onEdit} className="menu-item"><Pencil aria-hidden className="h-4 w-4" /> Edit</button></MenuItem>
            {canReset && (
              <MenuItem><button type="button" onClick={() => reset.mutate({ id: rule.id })} className="menu-item"><RotateCcw aria-hidden className="h-4 w-4" /> Reset to its source</button></MenuItem>
            )}
            <MenuItem>
              <button type="button" className="menu-item"
                onClick={() => edit.mutate({ id: rule.id, patch: { off: !rule.off }, done: `${name} ${rule.off ? 'turned on' : 'turned off'}` })}>
                <Power aria-hidden className="h-4 w-4" /> {rule.off ? 'Turn on' : 'Turn off'}
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </div>
      <p className="text-meta text-fg-muted">
        {source.join(' · ')}{link && <> · <SourceLink url={link} /></>}
      </p>
      {rule.words && <Truncate as="p" lines={2} reveal="more" className="text-meta italic text-fg-2">{`“${rule.words}”`}</Truncate>}
      {conflict && (
        <p data-tone="warn" className="tone-soft flex flex-wrap items-center gap-x-2 rounded-row px-2 py-1 text-meta">
          <span className="tone-text">{conflict} — yours says {ruleFacts(rule, stores)[0]}.</span>
          <button type="button" onClick={() => reset.mutate({ id: rule.id })} className="font-semibold text-accent-600 hover:underline">Use the source's</button>
        </p>
      )}
    </li>
  )
}
