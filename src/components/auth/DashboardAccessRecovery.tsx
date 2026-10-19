'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CircleAlert, LogIn, RotateCcw, ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { authLoginUrl, isProtectedAppPath, safeAuthReturnPath } from '@/lib/auth/returnPath'
import styles from './DashboardAccessRecovery.module.css'

export default function DashboardAccessRecovery({ reason, returnTo, productLabel, embedded = false }: {
  reason: 'forbidden' | 'unavailable'; returnTo?: string; productLabel?: string; embedded?: boolean
}) {
  const [busy, setBusy] = useState<'retry' | 'login' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const forbidden = reason === 'forbidden'
  const Icon = forbidden ? ShieldAlert : CircleAlert
  const Container = embedded ? 'div' : 'main'
  const fallback = safeAuthReturnPath(returnTo, '/dashboard-v1')
  const label = productLabel ?? (fallback.startsWith('/renoapp/') ? 'RenoApp'
    : fallback.startsWith('/mina-uppdrag') ? 'Mina uppdrag'
      : fallback.startsWith('/admin') ? 'HusHub administration' : 'BesiktApp')

  function currentReturnPath() {
    return isProtectedAppPath(window.location.pathname)
      ? safeAuthReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`, fallback)
      : fallback
  }

  function retry() {
    setBusy('retry')
    setError(null)
    // A rewrite retains the module URL; direct recovery visits use its safe next.
    if (!isProtectedAppPath(window.location.pathname)) window.location.assign(currentReturnPath())
    else window.location.reload()
  }

  async function signInAgain() {
    setBusy('login')
    setError(null)
    const loginUrl = authLoginUrl(currentReturnPath())
    try {
      // A bare /login link redirects an existing session straight back here.
      // End only this session after the user's explicit button press.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      window.location.assign(loginUrl)
    } catch {
      setError('Det gick inte att öppna inloggningen. Kontrollera din internetanslutning och försök igen.')
      setBusy(null)
    }
  }

  return (
    <Container className={styles.page}>
      <div className={styles.container}>
        {!embedded && <Link href="/" className={styles.brand} aria-label="HusHub startsida">HusHub</Link>}
        <section className={styles.card} aria-labelledby="access-recovery-heading" aria-busy={busy !== null}>
          <span className={`${styles.icon}${forbidden ? ` ${styles.forbidden}` : ''}`}><Icon size={26} aria-hidden="true" /></span>
          <p className={styles.eyebrow}>{label}</p>
          <h1 id="access-recovery-heading">{forbidden ? 'Ditt konto saknar åtkomst' : 'Sidan kunde inte öppnas'}</h1>
          <p className={styles.intro}>{forbidden
            ? 'Du är inloggad, men ditt konto har inte behörighet till den här sidan.'
            : 'Vi kunde inte kontrollera din inloggning eller behörighet just nu. Det kan hända efter en tids inaktivitet eller vid ett tillfälligt anslutningsfel.'}</p>
          <div className={styles.help}>
            <h2>Så kommer du vidare</h2>
            <p>Försök igen. Om sidan fortfarande inte öppnas, logga in igen med ditt vanliga konto. Efter inloggningen kommer du tillbaka till sidan du var på.</p>
            {forbidden && <p>Om du fortfarande saknar åtkomst efter inloggningen, be den som administrerar ditt företag eller din förening kontrollera din behörighet.</p>}
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
