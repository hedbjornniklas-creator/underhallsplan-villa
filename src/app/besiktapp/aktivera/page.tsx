import type { Metadata } from 'next'
import PublicFrame from '@/components/public/PublicFrame'
import BesiktInvitationAccept from '@/components/public/BesiktInvitationAccept'
export const metadata: Metadata = { title: 'Aktivera BesiktApp', robots: { index: false, follow: false }, referrer: 'no-referrer' }
export default function ActivateBesiktAppPage() { return <PublicFrame activeProduct="besiktapp"><BesiktInvitationAccept /></PublicFrame> }
