import { redirect } from 'next/navigation'
import { projectUrl } from '@/lib/action-cases/projectNavigation'

export default async function LegacyCustomerOfferPage({ params }: { params: Promise<{ caseId: string }> }) {
  redirect(projectUrl((await params).caseId, 'contract'))
}
