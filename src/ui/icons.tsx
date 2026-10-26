/** The transport's pictures, drawn on a 24 by 24 grid. They carry no words: the buttons that hold them are labelled. */
const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true, focusable: 'false' } as const

export const PlayIcon = () => (
  <svg {...common}>
    <path d="M8 5v14l11-7z" />
  </svg>
)

export const PauseIcon = () => (
  <svg {...common}>
    <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
  </svg>
)

export const PreviousCutIcon = () => (
  <svg {...common}>
    <path d="M6 5h2v14H6zM20 5v14L9 12z" />
  </svg>
)

export const NextCutIcon = () => (
  <svg {...common}>
    <path d="M16 5h2v14h-2zM4 5l11 7L4 19z" />
  </svg>
)

export const FrameBackIcon = () => (
  <svg {...common}>
    <path d="M15 6v12l-8-6zM18 6h2v12h-2z" opacity="0" />
    <path d="M17 6v12l-9-6z" />
    <path d="M6 6h2v12H6z" />
  </svg>
)

export const FrameForwardIcon = () => (
  <svg {...common}>
    <path d="M7 6v12l9-6z" />
    <path d="M16 6h2v12h-2z" />
  </svg>
)

export const ZoomInIcon = () => (
  <svg {...common}>
    <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
  </svg>
)

export const ZoomOutIcon = () => (
  <svg {...common}>
    <path d="M5 11h14v2H5z" />
  </svg>
)
