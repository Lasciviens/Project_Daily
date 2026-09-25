// The design's solid gamepad (phone header logo and the active Library tab).
// Drawn rather than taken from lucide, whose Gamepad2 is outline-only: filling
// it hides its own d-pad and buttons. Here they are cut out (evenodd), so the
// background shows through them the way the design draws it.
export function TgMobileGamepad({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
    >
      <path
        d={[
          'M7.2 5.5H16.8C19.1 5.5 21 7.2 21.4 9.4L22.4 15.6C22.8 18 21 20 18.9 20C17.9 20 17 19.6 16.3 18.9L14.9 17.5H9.1L7.7 18.9C7 19.6 6.1 20 5.1 20C3 20 1.2 18 1.6 15.6L2.6 9.4C3 7.2 4.9 5.5 7.2 5.5Z',
          'M6.75 9.6H8.25V10.95H9.6V12.45H8.25V13.8H6.75V12.45H5.4V10.95H6.75Z',
          'M16.75 10.6A1.15 1.15 0 1 1 14.45 10.6A1.15 1.15 0 1 1 16.75 10.6Z',
          'M19.05 12.9A1.15 1.15 0 1 1 16.75 12.9A1.15 1.15 0 1 1 19.05 12.9Z',
        ].join('')}
      />
    </svg>
  )
}
