import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import './globals.css'
import './oasis-emoji.css'
import './oasis-ui-fonts.css'
import { isHostedOasis } from '@/lib/oasis-profile'
import { LocalServiceWorkerGuard } from '@/components/LocalServiceWorkerGuard'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Root Layout
// ─═̷─═̷─🅰─═̷─═̷─ Fonts catalog mirrored in src/lib/fonts.ts ─═̷─═̷─🅰─═̷─═̷─
// The four UI fonts ship inside the Oasis (oasis-ui-fonts.css, files in
// public/fonts/ui): no build ever needs Google Fonts. Each family has a CSS
// variable on :root; Settings.uiFont picks which one the UI consumes —
// see src/lib/fonts.ts for the picker side of the wiring.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// The manifest comes from src/app/manifest.ts (Next links it). On this computer the Oasis wears its own
// icon (the ":4516" sunset), so its tab and its installed window are easy to find.
const localOasis = !isHostedOasis()

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
      <body>
        <LocalServiceWorkerGuard />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
