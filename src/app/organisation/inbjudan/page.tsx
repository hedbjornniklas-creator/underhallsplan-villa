import type { Metadata } from 'next'
import PublicFrame from '@/components/public/PublicFrame'
import OrganizationInvitationAccept from '@/components/organizations/OrganizationInvitationAccept'

export const metadata: Metadata = {
  title: 'Inbjudan till din organisation – HusHub',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function OrganizationInvitationPage() {
  return <PublicFrame activeProduct="besiktapp"><OrganizationInvitationAccept /></PublicFrame>
}
