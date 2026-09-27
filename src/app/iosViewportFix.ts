// iOS standalone PWAs (black-translucent status bar) can report a layout
// viewport that is short by the top safe area, so `100dvh` and
// `position: fixed; bottom: 0` stop above the real screen bottom — the tab
// bar floats with an empty strip under it. Measure the shortfall against the
// physical screen and expose it as --ios-viewport-gap; 0 everywhere else.
export function installIosViewportFix(): void {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  if (!standalone) return

  const apply = () => {
    const portrait = window.innerHeight >= window.innerWidth
    const expected = portrait
      ? Math.max(screen.width, screen.height)
      : Math.min(screen.width, screen.height)
    const gap = Math.round(expected - window.innerHeight)
    const clamped = gap > 0 && gap <= 80 ? gap : 0
    document.documentElement.style.setProperty('--ios-viewport-gap', `${clamped}px`)
  }

  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', () => setTimeout(apply, 300))
}
