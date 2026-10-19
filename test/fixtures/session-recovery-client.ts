// Browser-only synthetic authentication. This preview has no credentials,
// network authentication or access to the application's real Supabase client.
type SignOutEvent = { phase: 'started' | 'finished' | 'failed'; scope?: string; at: number }

function record(event: SignOutEvent) {
  const events = JSON.parse(sessionStorage.getItem('recovery-signout-events') ?? '[]') as SignOutEvent[]
  sessionStorage.setItem('recovery-signout-events', JSON.stringify([...events, event]))
}

export const supabase = {
  auth: {
    async signOut(options?: { scope?: string }) {
      record({ phase: 'started', scope: options?.scope, at: Date.now() })
      await new Promise(resolve => setTimeout(resolve, 250))
      const mode = new URLSearchParams(location.search).get('signout')
      if (mode === 'reject') {
        record({ phase: 'failed', scope: options?.scope, at: Date.now() })
        throw Error('SYNTHETIC_PRIVATE_AUTH_ERROR')
      }
      if (mode === 'error') {
        record({ phase: 'failed', scope: options?.scope, at: Date.now() })
        return { error: { message: 'SYNTHETIC_PRIVATE_AUTH_ERROR' } }
      }
      record({ phase: 'finished', scope: options?.scope, at: Date.now() })
      return { error: null }
    },
  },
}
