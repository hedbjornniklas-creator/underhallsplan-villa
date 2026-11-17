import { redirect } from 'next/navigation'
import { legacyTuOverviewHref } from '@/lib/tu/legacyListRedirect'

export default async function LegacyInvestigationList({ searchParams }: {
  searchParams: Promise<{ orgId?: string | string[] }>
}) {
  redirect(legacyTuOverviewHref(await searchParams))
}
