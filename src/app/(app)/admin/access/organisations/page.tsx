import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/access/server'
import OrganizationAdministrationClient from './OrganizationAdministrationClient'

export default async function OrganizationAdministrationPage() {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect(authLoginUrl(await currentAuthReturnPath('/admin/access/organisations')))
    return <DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={await currentAuthReturnPath('/admin/access/organisations')} productLabel="Organisationshantering" />
  }
  return <OrganizationAdministrationClient />
}
