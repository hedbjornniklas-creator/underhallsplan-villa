import { requireModuleAccess } from '@/lib/access/server'
import BesiktInterestList from '@/components/public/BesiktInterestList'

export default async function BesiktInterestAdminPage() {
  await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
  return <BesiktInterestList />
}
