import type { ComponentType, LazyExoticComponent } from 'react'
import { lazyWithReload } from '../utils/lazyWithReload'
import { ModalChunkFailed } from './ModalChunkFailed'
import type { EntityModalProps, ModalKind } from './types'

// kind → lazily loaded modal. One chunk per kind, so a page ships only the
// popups it actually opens. Each module exports a component taking exactly
// EntityModalProps<K> and loading its own data by id (see types.ts rules).
// The mapped type makes a missing kind a compile error.
type Entry<K extends ModalKind> = LazyExoticComponent<ComponentType<EntityModalProps<K>>>
const L = <K extends ModalKind>(kind: K, load: () => Promise<ComponentType<EntityModalProps<K>>>): Entry<K> =>
  lazyWithReload(`modal-${kind}`, load, ModalChunkFailed)

const plan = () => import('../components/plan-modal/PlanEntityModals')

export const MODAL_REGISTRY: { [K in ModalKind]: Entry<K> } = {
  'task':           L('task', () => plan().then(m => m.TaskEntityModal)),
  'time-block':     L('time-block', () => plan().then(m => m.TimeBlockEntityModal)),
  'schedule-block': L('schedule-block', () => plan().then(m => m.ScheduleBlockEntityModal)),
  'plan-block':     L('plan-block', () => plan().then(m => m.PlanBlockEntityModal)),
  'food-log':       L('food-log', () => import('../../features/recipes/modals/FoodLogEntityModal').then(m => m.FoodLogEntityModal)),
  'food-log-edit':  L('food-log-edit', () => import('../../features/recipes/modals/FoodLogEditEntityModal').then(m => m.FoodLogEditEntityModal)),
  'meal-plan':      L('meal-plan', () => import('../../features/recipes/modals/MealPlanEntityModal').then(m => m.MealPlanEntityModal)),
  'recipe':         L('recipe', () => import('../../features/recipes/modals/RecipeEntityModal').then(m => m.RecipeEntityModal)),
  'recipe-view':    L('recipe-view', () => import('../../features/recipes/modals/RecipeViewEntityModal').then(m => m.RecipeViewEntityModal)),
  'day-targets':    L('day-targets', () => import('../../features/daily/modals/DayTargetsEntityModal').then(m => m.DayTargetsEntityModal)),
  'media':          L('media', () => import('../../features/media/modals/MediaEntityModal').then(m => m.MediaEntityModal)),
  'hevy-workout':   L('hevy-workout', () => import('../../features/training/modals/HevyWorkoutEntityModal').then(m => m.HevyWorkoutEntityModal)),
  'wish':           L('wish', () => import('../../features/wishes/modals/WishEntityModal').then(m => m.WishEntityModal)),
  'project-item':   L('project-item', () => import('../../features/projects/modals/ProjectItemEntityModal').then(m => m.ProjectItemEntityModal)),
  'memory':         L('memory', () => import('../../features/ai/modals/MemoryEntityModal').then(m => m.MemoryEntityModal)),
  'confirm':        L('confirm', () => import('./ConfirmModal').then(m => m.ConfirmModal)),
}
