import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import SessionAccessGuard from '@/components/auth/SessionAccessGuard'
import PublicLogin from '@/components/public/PublicLogin'
import { getPublicLoginDestination } from '@/lib/publicNavigation'
import { safeAuthReturnPath } from '@/lib/auth/returnPath'
import { config, counters } from './session-recovery-client'

const pathname = location.pathname
const search = new URLSearchParams(location.search)
const directRecovery = pathname === '/auth/session-unavailable'
const destination = directRecovery ? safeAuthReturnPath(search.get('next'), '/dashboard-v1')
  : safeAuthReturnPath(`${pathname}${location.search}${location.hash}`, '/dashboard-v1')
const productLabel = pathname.startsWith('/renoapp/') ? 'RenoApp'
  : pathname.startsWith('/mina-uppdrag') ? 'Mina uppdrag'
    : pathname.startsWith('/admin') ? 'HusHub administration' : undefined

function PrivateWorkspace() {
  useEffect(() => { ++counters.childMounts; return () => { ++counters.childUnmounts } }, [])
  return <main data-private-workspace><h1>Syntetiskt privat arbetsutrymme</h1><label>Pågående anteckning <input aria-label="Pågående anteckning" defaultValue="" /></label></main>
}

const login = ['/login', '/renoapp/login', '/mina-uppdrag/logga-in'].includes(pathname)
createRoot(document.getElementById('root')!).render(login
  ? <PublicLogin destination={getPublicLoginDestination(search.get('next'))} resetSuccess={false} />
  : config.kind === 'guard' && !directRecovery
    ? <SessionAccessGuard productLabel={productLabel}><SessionAccessGuard productLabel={productLabel}><PrivateWorkspace /></SessionAccessGuard></SessionAccessGuard>
    : <DashboardAccessRecovery reason={directRecovery ? 'unavailable' : config.reason ?? 'forbidden'} returnTo={destination} productLabel={productLabel} />)
