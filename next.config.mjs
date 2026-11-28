// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS - Next.js Configuration
// The 3D engine where words become matter
// ─═̷─═̷─🔥─═̷─═̷─ Standalone mode — no longer nested in Parzival monorepo ─═̷─═̷─🔥─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Blue-green builds: NEXT_DIST_DIR=.next-staging for dev:agent mode
  ...(process.env.NEXT_DIST_DIR && { distDir: process.env.NEXT_DIST_DIR }),

  // ─═̷─═̷─🌐─═̷─═̷─ Run instrumentation.ts on Node startup. ─═̷─═̷─🌐─═̷─═̷─
  // Required on Next 14.x (becomes default in Next 15). Without this flag
  // the instrumentation hook is silently skipped — the IPv4 DNS-order patch
  // that fixes ENOTFOUND on half-IPv6 Windows networks would not run.
  experimental: {
    instrumentationHook: true,
  },

  // Transpile Three.js packages
  transpilePackages: ['three'],

  // Allow loading models from external sources if needed
  images: {
    unoptimized: true,
  },

  // Expose empty basePath to client code — root-served, no /oasis prefix
  env: {
    NEXT_PUBLIC_BASE_PATH: '',
    // The mode at build time, for the few defaults the browser needs before /api/session/init answers
    // (a hosted visitor's first body: src/lib/profile-defaults.ts). Empty for the local Oasis.
    NEXT_PUBLIC_OASIS_MODE: process.env.OASIS_MODE || '',
  },

  // Disable HMR in dev mode (use DISABLE_HMR=1 pnpm dev)
  ...(process.env.DISABLE_HMR === '1' && {
    webpack: (config, { dev }) => {
      if (dev) {
        config.watchOptions = { ignored: /.*/ }
      }
      return config
    },
  }),

  // Serve /presentation as static HTML (reveal.js slides)
  async rewrites() {
    return {
      afterFiles: [
        {
          source: '/presentation',
          destination: '/presentation/index.html',
        },
      ],
      // A built copy (next start) serves only the public/ files that were there when it started: a picture, video,
      // song, voice, model or screenshot made while he plays answered 404 (27 Nov 19:23, the first evening on the
      // built copy). When no page and no startup file matches a path that ends in a file extension, read it from
      // disk on this request (src/app/api/public-file/[...path]/route.ts: the same files, content type, ranges).
      fallback: [
        {
          source: '/:path((?!api/|_next/).*\\.[A-Za-z0-9]{1,8})',
          destination: '/api/public-file/:path',
        },
      ],
    }
  },

  // ─═̷─═̷─🔒─═̷─═̷─ Security headers ─═̷─═̷─🔒─═̷─═̷─
  async headers() {
    const securityHeaders = [
      // SAMEORIGIN, not DENY: the in-world browser frames the Oasis's own pages (builder, artifacts).
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Allow first-party mic/camera features on Oasis itself while keeping geolocation off.
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
    ]
    const immutableAssetHeaders = [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ...securityHeaders,
    ]
    return [
      { source: '/models/:path*', headers: immutableAssetHeaders },
      { source: '/avatars/:path*', headers: immutableAssetHeaders },
      { source: '/ground/:path*', headers: immutableAssetHeaders },
      { source: '/hdri/:path*', headers: immutableAssetHeaders },
      { source: '/textures/:path*', headers: immutableAssetHeaders },
      { source: '/thumbs/:path*', headers: immutableAssetHeaders },
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
