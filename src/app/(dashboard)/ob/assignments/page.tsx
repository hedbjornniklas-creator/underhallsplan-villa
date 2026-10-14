import { redirect } from 'next/navigation'
import { legacyObOverviewHref } from '@/lib/ob/legacyListRedirect'

export default async function LegacyAssignmentList({ searchParams }: {
  searchParams: Promise<{ orgId?: string | string[] }>
}) {
  redirect(legacyObOverviewHref(await searchParams))
}
