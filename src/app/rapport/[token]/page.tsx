import PublicReportPageContent from '@/components/report/PublicReportPageContent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Besiktningsutlåtande',
  robots: { index: false, follow: false },
}

export default async function PublicReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ pdf?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  // Public reading and sharing never inherit buyer controls from query strings
  // or from a buyer session that happens to exist in this browser.
  return <PublicReportPageContent publicToken={token} isPdfRender={query?.pdf === '1'} />
}
