export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'
export type ProjectColor  = 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose'
/** The template a project started from (migration 162). */
export type ProjectKind   = 'hardware' | 'software' | 'home' | 'learning' | 'trip' | 'blank'
/** Its tasks' domain follows it (a trigger moves them along). */
export type ProjectArea   = 'personal' | 'work'
export type PhaseStatus   = 'pending' | 'in_progress' | 'done'
export type BlockKind     = 'table' | 'log' | 'decisions' | 'pages' | 'links'
export type ColumnType    = 'text' | 'number' | 'money' | 'date' | 'link' | 'status' | 'check'
export type EntryState    = 'open' | 'decided'

export interface Project {
  id:             string
  user_id:        string
  name:           string
  description:    string | null
  notes:          string | null
  status:         ProjectStatus
  color:          ProjectColor
  sort_order:     number
  created_at:     string
  updated_at:     string
  // ── 162 — undefined before it runs ──
  kind?:           ProjectKind
  area?:           ProjectArea
  status_line?:    string | null
  /** When the status line last changed (set by the database). */
  status_line_at?: string | null
  started_on?:     string | null
  target_on?:      string | null
  link_url?:       string | null
}

export interface ProjectPhase {
  id:          string
  project_id:  string
  user_id:     string
  name:        string
  description: string | null
  status:      PhaseStatus
  sort_order:  number
  created_at:  string
  updated_at:  string
  // ── 162 ──
  /** The phase's finish line ("5 objects match the kitchen scale within 2 g"). */
  done_when?:  string | null
  target_on?:  string | null
  /** When it was marked done (set by the database). */
  done_at?:    string | null
}

/** One column of a table block. `key` is stable; the label can change. */
export interface TableColumn {
  key:      string
  label:    string
  type:     ColumnType
  /** A status column's choices, in order. */
  options?: string[]
}

export interface TableSettings {
  columns:  TableColumn[]
  /** A column whose values group the rows ("Boards", "Weighing"). */
  groupBy?: string | null
  /** Money columns' currency. */
  currency?: string
}

export interface ProjectBlock {
  id:         string
  user_id:    string
  project_id: string
  kind:       BlockKind
  title:      string
  settings:   Record<string, unknown>
  sort_order: number
  created_at: string
  updated_at: string
}

/** What a block holds: a table row (`data`), a log entry, a question or
 *  decision, a text page or a link — the block's kind says which fields mean what. */
export interface ProjectEntry {
  id:         string
  user_id:    string
  project_id: string
  block_id:   string
  title:      string | null
  body:       string | null
  url:        string | null
  entry_date: string | null
  state:      EntryState | null
  data:       Record<string, unknown>
  sort_order: number
  created_at: string
  updated_at: string
}

export interface NewProjectInput {
  name:         string
  kind:         ProjectKind
  area:         ProjectArea
  description?: string | null
}

export type ProjectPatch = Partial<Pick<Project,
  'name' | 'description' | 'notes' | 'status' | 'kind' | 'area' | 'status_line' | 'started_on' | 'target_on' | 'link_url'>>

export type PhasePatch = Partial<Pick<ProjectPhase, 'name' | 'status' | 'done_when' | 'target_on' | 'sort_order'>>

export interface NewPhaseInput {
  project_id: string
  name:       string
  done_when?: string | null
  target_on?: string | null
}

export interface NewBlockInput {
  project_id: string
  kind:       BlockKind
  title:      string
  settings?:  Record<string, unknown>
}

export type BlockPatch = Partial<Pick<ProjectBlock, 'title' | 'settings' | 'sort_order'>>

export type EntryFields = Partial<Pick<ProjectEntry, 'title' | 'body' | 'url' | 'entry_date' | 'state' | 'data' | 'sort_order'>>

export interface NewProjectTaskInput {
  project_id:       string
  project_phase_id: string | null
  title:            string
  domain:           ProjectArea
}
