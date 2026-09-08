import { notFound } from 'next/navigation'
import PublicReportPageContent from '@/components/report/PublicReportPageContent'
import { resolveEbCustomerReportLink } from '@/lib/eb/customerLinks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Besiktningsutlåtande', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function EbBuyerReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const context = await resolveEbCustomerReportLink(token)
  if (!context) notFound()
  return <PublicReportPageContent publicToken={context.publicToken}
    buyerFollowUpEndpoint={context.expired ? undefined : `/api/eb/customer/${encodeURIComponent(token)}/follow-up`}
    buyerAccessExpired={context.expired} />
}
