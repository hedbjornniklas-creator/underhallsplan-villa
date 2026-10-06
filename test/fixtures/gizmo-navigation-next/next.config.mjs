import { resolve } from 'node:path'
const root = process.env.GIZMO_NAV_REPO_ROOT
if (!root) throw Error('Synthetic test root required')
export default {
  typescript: { ignoreBuildErrors: true },
  webpack(config) {
    Object.assign(config.resolve.alias, {
      '@/lib/supabaseClient$': resolve(root, 'test/helpers/project-supabase-stub.ts'),
      '@': resolve(root, 'src'), '@fixture': resolve(root, 'test/fixtures'),
    })
    return config
  },
}
