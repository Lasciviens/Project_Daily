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
const shop = () => import('../../features/shop/modals/ShopEntityModals')
const projects = () => import('../../features/projects/modals/ProjectEntityModals')
const football = () => import('../../features/football/modals/FootballEntityModals')

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
  'supplement-schedule': L('supplement-schedule', () => import('../../features/supplements/modals/SupplementScheduleEntityModal').then(m => m.SupplementScheduleEntityModal)),
  'supplement-dose': L('supplement-dose', () => import('../../features/supplements/modals/SupplementDoseEntityModal').then(m => m.SupplementDoseEntityModal)),
  'media':          L('media', () => import('../../features/media/modals/MediaEntityModal').then(m => m.MediaEntityModal)),
  'training-session': L('training-session', () => import('../../features/training/modals/TrainingSessionEntityModal').then(m => m.TrainingSessionEntityModal)),
  'training-plan-move': L('training-plan-move', () => import('../../features/training/modals/TrainingPlanSheets').then(m => m.TrainingPlanMoveModal)),
  'training-plan-skip': L('training-plan-skip', () => import('../../features/training/modals/TrainingPlanSheets').then(m => m.TrainingPlanSkipModal)),
  'exercise':       L('exercise', () => import('../../features/training/modals/ExerciseEntityModal').then(m => m.ExerciseEntityModal)),
  'health-workout': L('health-workout', () => import('../../features/health/modals/HealthWorkoutEntityModal').then(m => m.HealthWorkoutEntityModal)),
  'body-measurement': L('body-measurement', () => import('../../features/health/modals/BodyMeasurementEntityModal').then(m => m.BodyMeasurementEntityModal)),
  'wish':           L('wish', () => import('../../features/wishes/modals/WishEntityModal').then(m => m.WishEntityModal)),
  'shop-item':      L('shop-item', () => import('../../features/shop/modals/ShopItemEntityModal').then(m => m.ShopItemEntityModal)),
  'shop-sell':      L('shop-sell', () => shop().then(m => m.ShopSellModal)),
  'shop-chain':     L('shop-chain', () => shop().then(m => m.ShopChainModal)),
  'shop-accessory': L('shop-accessory', () => shop().then(m => m.ShopAccessoryModal)),
  'shop-model':     L('shop-model', () => shop().then(m => m.ShopModelModal)),
  'shop-own':       L('shop-own', () => shop().then(m => m.ShopOwnModal)),
  'shop-chain-builder': L('shop-chain-builder', () => import('../../features/shop/modals/ShopChainBuilderModal').then(m => m.ShopChainBuilderModal)),
  'project':        L('project', () => projects().then(m => m.ProjectEntityModal)),
  'project-phase':  L('project-phase', () => projects().then(m => m.ProjectPhaseEntityModal)),
  'project-block':  L('project-block', () => import('../../features/projects/modals/ProjectBlockEntityModal').then(m => m.ProjectBlockEntityModal)),
  'project-entry':  L('project-entry', () => import('../../features/projects/modals/ProjectEntryEntityModal').then(m => m.ProjectEntryEntityModal)),
  'football-follow': L('football-follow', () => football().then(m => m.FootballFollowModal)),
  'football-team':  L('football-team', () => football().then(m => m.FootballTeamModal)),
  'football-player': L('football-player', () => football().then(m => m.FootballPlayerModal)),
  'football-match': L('football-match', () => football().then(m => m.FootballMatchModal)),
  'memory':         L('memory', () => import('../../features/ai/modals/MemoryEntityModal').then(m => m.MemoryEntityModal)),
  'book':           L('book', () => import('../../features/books/modals/BookEntityModal').then(m => m.BookEntityModal)),
  'undo-save':      L('undo-save', () => import('../../features/developer/modals/UndoSaveEntityModal').then(m => m.UndoSaveEntityModal)),
  'confirm':        L('confirm', () => import('./ConfirmModal').then(m => m.ConfirmModal)),
}
