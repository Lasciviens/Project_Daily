import { useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { routeTitle } from '../../../app/navigation'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import type { PageContext } from '../devRequestContext'
import { readPageContext } from './pickDom'

/** Returns a reader for the page as it is right now (route, tabs, popups, screen). */
export function usePageContextReader(): () => PageContext {
  const { pathname, search } = useLocation()
  const breakpoint = useBreakpoint()
  return useCallback(
    () => readPageContext(`${pathname}${search}`, routeTitle(pathname), breakpoint),
    [pathname, search, breakpoint],
  )
}
