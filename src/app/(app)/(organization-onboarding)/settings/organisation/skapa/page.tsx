import { redirect } from 'next/navigation'
import OrganizationCreateForm from '@/components/organizations/OrganizationCreateForm'
import SettingsNav from '@/components/settings/SettingsNav'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// This route deliberately lives outside settings/layout: creating your first
// organization requires an account, not an existing Dashboard membership.
export default async function CreateOrganizationPage() {
  const supabase = createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) redirect('/login?next=%2Fsettings%2Forganisation%2Fskapa')

  return (
    <div className="min-h-full bg-slate-50 px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <SettingsNav />
        <OrganizationCreateForm />
      </div>
    </div>
  )
}
