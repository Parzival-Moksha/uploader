import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import './globals.css'
import { isHostedOasis } from '@/lib/oasis-profile'
import { LocalServiceWorkerGuard } from '@/components/LocalServiceWorkerGuard'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Root Layout
// ─═̷─═̷─🅰─═̷─═̷─ Fonts catalog mirrored in src/lib/fonts.ts ─═̷─═̷─🅰─═̷─═̷─
// The four UI fonts ship inside the Oasis (public/fonts/ui/oasis-ui-fonts.css, files
// beside it): no build ever needs Google Fonts. Each family has a CSS
// variable on :root; Settings.uiFont picks which one the UI consumes —
// see src/lib/fonts.ts for the picker side of the wiring.
// The font faces (and the emoji's) are a plain stylesheet linked in <head>, not
// imported here: an import puts them in the app's CSS, which the dev server swaps
// on every Tailwind rebuild, and each swap made the browser load the fonts again and
// show a fallback for seconds (the owner, 2026-11-25: "the font change super often").
// A linked file never changes in the page, so the fonts load once.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// The manifest comes from src/app/manifest.ts (Next links it). On this computer the Oasis wears its own
// icon (the ":4516" sunset), so its tab and its installed window are easy to find.
const localOasis = !isHostedOasis()

const UI_FONT_PRELOADS = ['cinzel', 'cormorant-garamond', 'space-grotesk', 'jetbrains-mono'].map(f => `/fonts/ui/${f}-latin.woff2`)

export const metadata: Metadata = {
  title: 'Oasis',
  description: 'Text-to-3D world builder',
  icons: localOasis
    ? { icon: [{ url: '/icons/oasis-local-48.png', sizes: '48x48', type: 'image/png' }, { url: '/favicon.svg', type: 'image/svg+xml' }], apple: '/icons/oasis-local-apple-180.png' }
    : { icon: '/favicon.svg' },
  appleWebApp: {
    capable: true,
    title: 'Oasis',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* The four faces the first screen uses, fetched with the page rather than when CSS first asks. */}
        {UI_FONT_PRELOADS.map(href => <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="" />)}
        <link rel="stylesheet" href="/fonts/ui/oasis-ui-fonts.css" />
        <link rel="stylesheet" href="/fonts/emoji/oasis-emoji.css" />
      </head>
      <body>
        <LocalServiceWorkerGuard />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
