import type { EntityModalProps } from '../../../shared/modals/types'
import { EntityModalPending } from '../../recipes/modals/entityModalLoad'
import { useFirstLoaded } from '../../recipes/modals/useFirstLoaded'
import { usePhases, useItems } from '../hooks/useProjects'
import { ProjectItemModal } from '../components/ProjectItemModal'

/** `project-item`: add an item to a project (optionally into a phase), or edit one by id. */
export function ProjectItemEntityModal({ request, onClose }: EntityModalProps<'project-item'>) {
  const { projectId, id, phaseId } = request
  const phasesQ = usePhases(projectId)
  const itemsQ = useItems(id ? projectId : null)
  const item = useFirstLoaded(id ? itemsQ.data?.find(i => i.id === id) : undefined)

  if (!phasesQ.data) return <EntityModalPending query={phasesQ} what="project" size="sm" onClose={onClose} />
  if (id && !item) return <EntityModalPending query={itemsQ} what="item" size="sm" onClose={onClose} />
  return (
    <ProjectItemModal
      onClose={onClose}
      projectId={projectId}
      phases={phasesQ.data}
      defaultPhaseId={phaseId}
      item={item ?? null}
    />
  )
}
