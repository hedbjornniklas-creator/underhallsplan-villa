'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CircleAlert, LogIn, RotateCcw, ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import styles from './DashboardAccessRecovery.module.css'

export default function DashboardAccessRecovery({ reason, embedded = false }: { reason: 'forbidden' | 'unavailable'; embedded?: boolean }) {
  const [busy, setBusy] = useState<'retry' | 'login' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const forbidden = reason === 'forbidden'
  const Icon = forbidden ? ShieldAlert : CircleAlert
  const Container = embedded ? 'div' : 'main'

  function retry() {
    setBusy('retry')
    setError(null)
    // The public recovery page is also reachable directly. A proxy rewrite
    // retains /dashboard-v1 in the browser, so reload rechecks its session.
    if (window.location.pathname === '/auth/session-unavailable') window.location.assign('/dashboard-v1')
    else window.location.reload()
  }

  async function signInAgain() {
    setBusy('login')
    setError(null)
    try {
      // A bare /login link redirects an existing session straight back here.
      // End only this session after the user's explicit button press.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      window.location.assign('/login?next=%2Fdashboard-v1')
    } catch {
      setError('Det gick inte att öppna inloggningen. Kontrollera din internetanslutning och försök igen.')
      setBusy(null)
    }
  }

  return (
    <Container className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.brand} aria-label="HusHub startsida">HusHub</Link>
        <section className={styles.card} aria-labelledby="access-recovery-heading" aria-busy={busy !== null}>
          <span className={`${styles.icon}${forbidden ? ` ${styles.forbidden}` : ''}`}><Icon size={26} aria-hidden="true" /></span>
          <p className={styles.eyebrow}>BesiktApp</p>
          <h1 id="access-recovery-heading">{forbidden ? 'Ditt konto saknar åtkomst' : 'Sidan kunde inte öppnas'}</h1>
          <p className={styles.intro}>{forbidden
            ? 'Du är inloggad, men ditt konto har inte behörighet till BesiktApp.'
            : 'Vi kunde inte kontrollera din inloggning eller behörighet just nu. Det kan hända efter en tids inaktivitet eller vid ett tillfälligt anslutningsfel.'}</p>
          <div className={styles.help}>
            <h2>Så kommer du vidare</h2>
            <p>Försök igen. Om sidan fortfarande inte öppnas, logga in igen med kontot som du använder i ditt företag.</p>
            {forbidden && <p>Om du fortfarande saknar åtkomst efter inloggningen, be företagets administratör kontrollera din behörighet.</p>}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy !== null} onClick={retry}>
              <RotateCcw size={17} aria-hidden="true" />{busy === 'retry' ? 'Försöker igen…' : 'Försök igen'}
            </button>
            <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => void signInAgain()}>
              <LogIn size={17} aria-hidden="true" />{busy === 'login' ? 'Öppnar inloggningen…' : 'Logga in igen'}
            </button>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <p className={styles.caption}>När du väljer ”Logga in igen” avslutas din nuvarande inloggning i den här webbläsaren.</p>
        </section>
        <Link href="/" className={styles.home}><ArrowLeft size={15} aria-hidden="true" />Till HusHub</Link>
      </div>
    </Container>
  )
}
