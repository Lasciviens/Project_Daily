import { BookOpen, Code2, Cpu, Folder, Home, Link2, ListChecks, MessageCircleQuestion, NotebookPen, Plane, Table2, type LucideIcon } from 'lucide-react'
import type { BlockKind, ProjectKind } from './types'

/** A project's icon follows the template it started from. */
export const KIND_ICON: Record<ProjectKind, LucideIcon> = {
  hardware: Cpu, software: Code2, home: Home, learning: BookOpen, trip: Plane, blank: Folder,
}

export const BLOCK_ICON: Record<BlockKind, LucideIcon> = {
  table: Table2, log: NotebookPen, decisions: MessageCircleQuestion, pages: ListChecks, links: Link2,
}
