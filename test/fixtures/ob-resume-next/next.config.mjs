import { resolve } from 'node:path'
const root = process.env.OB_RESUME_REPO_ROOT
if (!root) throw Error('Synthetic test root required')
export default {
  reactStrictMode: true,
  // The fixture compiles sources outside its app root; the repository's full
  // TypeScript check is run separately, not with generated fixture route types.
  typescript: { ignoreBuildErrors: true },
  webpack(config) {
    Object.assign(config.resolve.alias, {
      '@/lib/supabaseClient$': resolve(root, 'test/fixtures/ob-mobile-round-client.ts'),
      '@/components/Protected$': resolve(root, 'test/fixtures/ob-round-navigation.tsx'),
      '@/components/ob/ObWizard$': resolve(root, 'test/fixtures/ob-round-wizard.tsx'),
      '@': resolve(root, 'src'),
    })
    return config
  },
}
