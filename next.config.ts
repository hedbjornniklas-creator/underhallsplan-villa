import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async headers() {
    const privateBearerHeaders = [
      { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    ]
    return [
      {
        source: '/signe/:path*',
        headers: privateBearerHeaders,
      },
      {
        source: '/api/signe/:path*',
        headers: privateBearerHeaders,
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'rfresrbuekidumbwzpcm.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  outputFileTracingIncludes: {
    '/api/**/*': [
      'node_modules/@sparticuz/chromium/bin/**/*',
      'node_modules/@sparticuz/chromium/build/**/*',
    ],
  },
}

export default nextConfig
