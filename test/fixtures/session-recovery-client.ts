// Browser-only synthetic SDK: no credentials, network authentication or real
// Supabase operations. Every auth event and call is inspectable by local QA.
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

type SignOutEvent = { phase: 'started' | 'finished' | 'failed'; scope?: string; at: number }
type SessionMode = 'healthy' | 'missing' | 'error' | 'reject'
export type RecoveryConfig = { kind?: 'guard' | 'recovery'; reason?: 'forbidden' | 'unavailable'; sessionMode?: SessionMode; signout?: 'reject' | 'error' }

export const counters = { getSession: 0, sessionChecksCompleted: 0, subscriptions: 0, unsubscriptions: 0, childMounts: 0, childUnmounts: 0 }
declare global {
  interface Window {
    __sessionQAConfig?: RecoveryConfig
    __sessionRecoveryTest: {
      counters: typeof counters
      setSessionMode: (mode: SessionMode) => void
      emitSignedOut: () => void
      emitSignedIn: (userId: string) => void
      emitTokenRefreshed: () => void
    }
  }
}
export const config = window.__sessionQAConfig ?? {}
const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>()
let mode: SessionMode = (sessionStorage.getItem('synthetic-session-mode') as SessionMode | null) ?? config.sessionMode ?? 'missing'
let userId = 'synthetic-account-a'
const session = () => ({ user: { id: userId }, access_token: 'synthetic-only', refresh_token: 'synthetic-only' }) as Session

function emit(event: AuthChangeEvent, value: Session | null) {
  for (const listener of listeners) listener(event, value)
}
function record(event: SignOutEvent) {
  const events = JSON.parse(sessionStorage.getItem('recovery-signout-events') ?? '[]') as SignOutEvent[]
  sessionStorage.setItem('recovery-signout-events', JSON.stringify([...events, event]))
}
window.__sessionRecoveryTest = {
  counters,
  setSessionMode(next) { mode = next },
  emitSignedOut() { mode = 'missing'; emit('SIGNED_OUT', null) },
  emitSignedIn(nextUserId) { userId = nextUserId; mode = 'healthy'; emit('SIGNED_IN', session()) },
  emitTokenRefreshed() { emit('TOKEN_REFRESHED', session()) },
}

export const supabase = {
  auth: {
    async getSession() {
      ++counters.getSession
      await new Promise(resolve => setTimeout(resolve, 20))
      ++counters.sessionChecksCompleted
      if (mode === 'reject') throw Error('SYNTHETIC_PRIVATE_AUTH_ERROR')
      return { data: { session: mode === 'healthy' ? session() : null }, error: mode === 'error' ? Error('SYNTHETIC_PRIVATE_AUTH_ERROR') : null }
    },
    onAuthStateChange(listener: (event: AuthChangeEvent, session: Session | null) => void) {
      ++counters.subscriptions
      listeners.add(listener)
      return { data: { subscription: { unsubscribe() { ++counters.unsubscriptions; listeners.delete(listener) } } } }
    },
    async signInWithPassword() {
      mode = 'healthy'
      sessionStorage.setItem('synthetic-session-mode', mode)
      emit('SIGNED_IN', session())
      return { data: { session: session() }, error: null }
    },
    async signOut(options?: { scope?: string }) {
      record({ phase: 'started', scope: options?.scope, at: Date.now() })
      await new Promise(resolve => setTimeout(resolve, 250))
      if (config.signout === 'reject') {
        record({ phase: 'failed', scope: options?.scope, at: Date.now() })
        throw Error('SYNTHETIC_PRIVATE_AUTH_ERROR')
      }
      if (config.signout === 'error') {
        record({ phase: 'failed', scope: options?.scope, at: Date.now() })
        return { error: { message: 'SYNTHETIC_PRIVATE_AUTH_ERROR' } }
      }
      mode = 'missing'
      sessionStorage.setItem('synthetic-session-mode', mode)
      record({ phase: 'finished', scope: options?.scope, at: Date.now() })
      emit('SIGNED_OUT', null)
      return { error: null }
    },
  },
}
