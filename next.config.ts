import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
