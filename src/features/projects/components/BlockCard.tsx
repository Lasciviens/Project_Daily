import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEntityModal } from '../../../shared/modals'
import { Button, Card, CardHeader } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useDeleteBlock, useMoveBlock } from '../hooks/useProjects'
import { swapWith } from '../projectModel'
import { BLOCK_ICON } from '../projectIcons'
import { TableBlockBody } from './TableBlock'
import { DecisionsBody, LinksBody, LogBody, PagesBody } from './EntryBlocks'
import type { ProjectBlock, ProjectEntry } from '../types'

const ADD_LABEL: Record<ProjectBlock['kind'], string> = { table: 'Row', log: 'Entry', decisions: 'Question', pages: 'Page', links: 'Link' }

/** One block: its name, an add button and its ⋯ (edit, move, delete), then what it holds. */
export function BlockCard({ block, entries, blocks }: { block: ProjectBlock; entries: ProjectEntry[]; blocks: ProjectBlock[] }) {
  const modal = useEntityModal()
  const move = useMoveBlock()
  const del = useDeleteBlock(block.project_id)
  const Icon = BLOCK_ICON[block.kind]
  const up = swapWith(blocks, block.id, -1)
  const down = swapWith(blocks, block.id, 1)
  const add = () => modal.open({ kind: 'project-entry', projectId: block.project_id, blockId: block.id })

  return (
    <Card id={`block-${block.id}`} className="@container scroll-mt-24">
      <CardHeader
        variant="label"
        icon={<Icon />}
        title={block.title}
        action={
          <div className="flex items-center">
            <Button variant="ghost" size="sm" icon={<Plus />} onClick={add} aria-label={`Add a ${ADD_LABEL[block.kind].toLowerCase()} to ${block.title}`}>
              <span className="sr-only @[26rem]:not-sr-only">{ADD_LABEL[block.kind]}</span>
            </Button>
            <Menu as="div">
              <MenuButton className="icon-btn" aria-label={`More for ${block.title}`} title={`More for ${block.title}`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </MenuButton>
              <MenuItems anchor="bottom end" transition className="menu w-48 [--anchor-gap:4px] transition duration-150 data-[closed]:opacity-0">
                <MenuItem>
                  <button type="button" className="menu-item" onClick={() => modal.open({ kind: 'project-block', projectId: block.project_id, id: block.id })}>
                    <Pencil aria-hidden className="h-4 w-4" /> {block.kind === 'table' ? 'Name and columns' : 'Rename'}
                  </button>
                </MenuItem>
                {up && (
                  <MenuItem>
                    <button type="button" className="menu-item" onClick={() => move.mutate({ a: up[0], b: up[1] })}>
                      <ArrowUp aria-hidden className="h-4 w-4" /> Move up
                    </button>
                  </MenuItem>
                )}
                {down && (
                  <MenuItem>
                    <button type="button" className="menu-item" onClick={() => move.mutate({ a: down[0], b: down[1] })}>
                      <ArrowDown aria-hidden className="h-4 w-4" /> Move down
                    </button>
                  </MenuItem>
                )}
                <div className="menu-sep" />
                <MenuItem>
                  <button type="button" className="menu-item is-danger" onClick={() => {
                    void del.run([block.id], {
                      title: `Delete ${block.title}?`,
                      message: entries.length ? `Its ${entries.length} ${entries.length === 1 ? 'entry goes' : 'entries go'} with it.` : undefined,
                      done: `${block.title} deleted`,
                    })
                  }}>
                    <Trash2 aria-hidden className="h-4 w-4" /> Delete block
                  </button>
                </MenuItem>
              </MenuItems>
            </Menu>
          </div>
        }
      />
      {/* The settings and rows come from the database as JSON: one odd value stays inside this card. */}
      <ErrorBoundary label={block.title}>
        {block.kind === 'table' ? <TableBlockBody block={block} rows={entries} onAdd={add} />
          : block.kind === 'log' ? <LogBody block={block} entries={entries} onAdd={add} />
          : block.kind === 'decisions' ? <DecisionsBody block={block} entries={entries} onAdd={add} />
          : block.kind === 'pages' ? <PagesBody block={block} entries={entries} onAdd={add} />
          : <LinksBody block={block} entries={entries} onAdd={add} />}
      </ErrorBoundary>
    </Card>
  )
}
