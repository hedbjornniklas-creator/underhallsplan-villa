import { authLoginUrl } from '@/lib/auth/returnPath'
import { authRecoveryReason, currentAuthReturnPath } from '@/lib/auth/serverRecovery'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireProductAccess } from '@/lib/access/server'

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  try {
    await requireProductAccess('dashboard')
  } catch (error) {
    const returnTo = await currentAuthReturnPath('/settings')
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      redirect(authLoginUrl(returnTo))
    }

    return <><DashboardAccessRecovery reason={authRecoveryReason(error)} returnTo={returnTo} productLabel="Inställningar" />{authRecoveryReason(error) === 'forbidden' && <p className="mx-auto max-w-3xl px-6 pb-8 text-sm text-slate-700">Du kan skapa ett nytt företag med ditt befintliga konto. Finns företaget redan behöver dess administratör bjuda in dig. <Link href="/settings/organisation/skapa" className="font-semibold text-indigo-700 underline">Skapa organisation</Link></p>}</>
  }

  return <>{children}</>
}
