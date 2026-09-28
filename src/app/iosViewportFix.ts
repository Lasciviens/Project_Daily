// iOS standalone PWAs (black-translucent status bar) sometimes lay out fixed
// elements against a viewport that is short by the top safe area, so
// `100dvh` and `position: fixed; bottom: 0` stop above the screen bottom and
// the tab bar floats. `innerHeight` is not a reliable signal (it can report
// the short value while fixed layout is already full height, which pushed the
// bar off-screen), so measure what `position: fixed; inset: 0` actually
// covers and expose the shortfall as --ios-viewport-gap (0 everywhere else).
export function installIosViewportFix(): void {
  // `navigator.standalone` exists only in iOS/iPadOS WebKit and is true only
  // for a home-screen app. `display-mode: standalone` also matches installed
  // Android and desktop PWAs, where screen height includes the system bars /
  // window chrome (a 50-80px "gap" that isn't one), which pushed the tab bar
  // below the screen and made #root taller than the window.
  if ((navigator as Navigator & { standalone?: boolean }).standalone !== true) return

  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText =
    'position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none'
  document.documentElement.appendChild(probe)

  const apply = () => {
    const fixedHeight = probe.getBoundingClientRect().height
    // Orientation from the viewport: iOS keeps `screen` in portrait values
    // whatever the rotation, so comparing screen.height with screen.width
    // always said "portrait" and a landscape phone measured against the long
    // side (the gap then fell outside 0..80 by accident).
    const portrait = window.innerWidth <= window.innerHeight
    const screenHeight = portrait
      ? Math.max(screen.width, screen.height)
      : Math.min(screen.width, screen.height)
    const gap = Math.round(screenHeight - fixedHeight)
    const clamped = gap > 0 && gap <= 80 ? gap : 0
    document.documentElement.style.setProperty('--ios-viewport-gap', `${clamped}px`)
  }

  const applySoon = () => {
    apply()
    setTimeout(apply, 350)
  }

  apply()
  window.addEventListener('resize', applySoon)
  window.addEventListener('orientationchange', applySoon)
  window.addEventListener('pageshow', applySoon)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applySoon()
  })
  window.visualViewport?.addEventListener('resize', applySoon)
}
