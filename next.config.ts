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
      { source: '/atgarder/:path*', headers: privateBearerHeaders },
      { source: '/api/eb/remediation/:path*', headers: privateBearerHeaders },
      { source: '/api/eb/customer/:path*', headers: privateBearerHeaders },
      { source: '/rapport/bestallare/:path*', headers: privateBearerHeaders },
      { source: '/atgardsarende/:path*', headers: privateBearerHeaders },
      { source: '/fraga/:path*', headers: privateBearerHeaders },
      { source: '/dagbok/:path*', headers: privateBearerHeaders },
      { source: '/api/dagbok/:path*', headers: privateBearerHeaders },
      { source: '/api/mina-uppdrag/fragor/:path*', headers: privateBearerHeaders },
      { source: '/api/action-cases/public/:path*', headers: privateBearerHeaders },
      { source: '/organisation/inbjudan', headers: privateBearerHeaders },
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
    '/api/ob/inspections/*/word': ['./public/report-assets/**/*', './src/content/standardtexts/**/*.txt'],
    '/api/action-cases/*/customer-offers': ['./public/abs18-2018-06.pdf', './public/hf17-2017.pdf'],
    '/api/action-cases/*/contract-signing{,/**}': ['./public/uppdrag/brand/pdf/*.ttf'],
    '/api/action-cases/*/customer-offers/pdf': ['./public/uppdrag/brand/pdf/*.ttf', './public/hf17-2017.pdf'],
    '/api/action-cases/*/customer-planning/*/pdf': ['./public/uppdrag/brand/pdf/*.ttf'],
    '/api/action-cases/*/invoice-basis/*/pdf': ['./public/uppdrag/brand/pdf/*.ttf'],
    '/api/action-cases/*/billing-flow/*/pdf': ['./public/uppdrag/brand/pdf/*.ttf'],
    '/api/**/*': [
      'node_modules/@sparticuz/chromium/bin/**/*',
      'node_modules/@sparticuz/chromium/build/**/*',
    ],
  },
  outputFileTracingExcludes: {
    // Browser/PDF runtime paths are dynamic. Do not bundle development artifacts
    // when the tracer conservatively follows those paths through the project.
    '/*': ['./tmp/**/*', './output/**/*', './docs/**/*', './test/**/*', './scripts/**/*'],
  },
}

export default nextConfig
