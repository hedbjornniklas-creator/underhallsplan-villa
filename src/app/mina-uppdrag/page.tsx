import { redirect } from 'next/navigation'
import RecipientPortalOverviewClient from '@/components/tasks/RecipientPortalOverviewClient'
import { recipientLoginUrl } from '@/lib/tasks/recipientAuthPaths'
import {
  getRecipientPortalOverview,
  requireRecipientPortalSession,
} from '@/lib/tasks/recipientPortal'

export const dynamic = 'force-dynamic'

export default async function RecipientPortalPage() {
  let session
  try {
    session = await requireRecipientPortalSession()
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(recipientLoginUrl('/mina-uppdrag'))
    }
    throw error
  }
  const overview = await getRecipientPortalOverview(session)
  return <RecipientPortalOverviewClient initialOverview={overview} />
}
