import { requireModuleAccess } from '@/lib/access/server'

export async function requireBrfAdminContext() {
  const context = await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'renoapp_admin' })
  return {
    userId: context.identity.userId,
    profile: {
      id: context.identity.profileId,
      email: context.identity.email,
      full_name: context.identity.fullName,
      is_admin: true,
    },
  }
}
