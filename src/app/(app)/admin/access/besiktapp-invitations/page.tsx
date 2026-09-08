import { requireModuleAccess } from '@/lib/access/server'
import BesiktInvitationsAdmin from '@/components/public/BesiktInvitationsAdmin'
export default async function BesiktInvitationsPage() {
  await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
  return <BesiktInvitationsAdmin />
}
