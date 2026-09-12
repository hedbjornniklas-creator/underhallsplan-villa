import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Building2 } from 'lucide-react'
import TuOrganizationProfileEditor from '@/components/tu/TuOrganizationProfileEditor'
import { getOrganizationProfileWorkspace } from '@/lib/organizations/profileCard'
import type { OrganizationProfileWorkspace } from '@/lib/organizations/profileCardTypes'
import { requireTuContext } from '@/lib/tu/server'

export const dynamic = 'force-dynamic'

export default async function TuOrganizationProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ orgId?: string | string[] }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const requestedOrgId = resolvedSearchParams.orgId
  let context: Awaited<ReturnType<typeof requireTuContext>> | null = null
  let workspace: OrganizationProfileWorkspace | null = null
  let description: string | null = null

  try {
    context = await requireTuContext(requestedOrgId)
    workspace = await getOrganizationProfileWorkspace({
      orgId: context.orgId,
      orgName: context.orgName,
      profileId: context.userId,
      role: context.role,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') redirect('/login')
    description =
      message === 'ORG_SELECTION_INVALID'
        ? 'Den valda organisationen är ogiltig.'
        : message === 'ORG_MEMBERSHIP_REQUIRED' || message === 'MODULE_ACCESS_REQUIRED'
          ? 'Du saknar TU-behörighet i den valda organisationen.'
          : 'Företagsprofilen kunde inte hämtas.'
  }

  if (!context || !workspace) {
    const tuHref = context
      ? `/tu?orgId=${encodeURIComponent(context.orgId)}`
      : '/tu'
    return (
      <main className="min-h-full bg-slate-50 px-4 py-8">
        <section className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-950 shadow-sm">
          <h1 className="text-lg font-semibold">Företagsprofilen kunde inte öppnas</h1>
          <p className="mt-2 text-sm">{description}</p>
          <Link href={tuHref} className="mt-4 inline-flex text-sm font-semibold text-rose-800 underline underline-offset-2">
            Tillbaka till TU
          </Link>
        </section>
      </main>
    )
  }

  const tuHref = `/tu?orgId=${encodeURIComponent(context.orgId)}`
  return (
    <main className="min-h-full bg-slate-50 px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Link
              href={tuHref}
              aria-label="Tillbaka till TU"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <ArrowLeft size={17} aria-hidden />
            </Link>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                <Building2 size={14} aria-hidden />
                TU-inställningar
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                Företagsvisitkort
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Aktiv arbetsorganisation: {context.orgName || 'Namnlös organisation'}
              </p>
            </div>
          </div>
        </header>

        <TuOrganizationProfileEditor
          key={context.orgId}
          initialWorkspace={workspace}
        />
      </div>
    </main>
  )
}
