// Which trips take the same way (Routes tab: the best trip's route on the
// left, the other routes on the right). Pure — no React, no API calls.
import type { TripPattern } from '../../api/ruterApi'

type Trip = Pick<TripPattern, 'legs'>

/** A trip's way: its rides in order, each as line + where you get on → where you
 *  get off. Walking and times don't count, so the same route at another time has
 *  the same signature. A trip with no ride at all is `walk`. */
export function routeSignature(trip: Trip): string {
  const rides = trip.legs
    .filter(leg => leg.mode !== 'foot')
    .map(leg => `${leg.line || leg.mode}:${leg.from}>${leg.to}`)
  return rides.length > 0 ? rides.join(' | ') : 'walk'
}

export interface TripGroups<T> {
  /** Trips on the best trip's route, the best (the first trip) first. */
  best:  T[]
  /** Every trip on another route — other lines or other stops — in the order given. */
  other: T[]
}

/** Splits trips by route; the first trip is the best one, as Entur orders them. */
export function groupTripsByRoute<T extends Trip>(trips: readonly T[]): TripGroups<T> {
  if (trips.length === 0) return { best: [], other: [] }
  const bestRoute = routeSignature(trips[0])
  const best: T[] = []
  const other: T[] = []
  for (const trip of trips) (routeSignature(trip) === bestRoute ? best : other).push(trip)
  return { best, other }
}

/** How many trips a column shows at first, and how many more each "Show more" adds. */
export const TRIPS_PER_STEP = 3
