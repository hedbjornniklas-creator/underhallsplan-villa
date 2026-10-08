// Synthetic dashboard reads only. No credentials or mutations in this preview.
export const homeTest = {
  writes: [] as { table: string; operation: string; values: unknown }[],
  navigations: [] as string[], createFailAt: '', quickStatus: 200, delay: 30,
  requests: [] as { url: string; body: unknown }[],
}
declare global { interface Window { __obHomeTest: typeof homeTest } }
window.__obHomeTest = homeTest
const session = { user: { id: 'preview-user' } }
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: session.user }, error: null }),
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (callback: (event: string, value: typeof session) => void) => {
      let active = true
      void Promise.resolve().then(() => { if (active) callback('INITIAL_SESSION', session) })
      return { data: { subscription: { unsubscribe() { active = false } } } }
    },
  },
  from(table: string) {
    if (!['properties', 'profiles', 'assignments', 'inspections', 'inspection_conditions', 'ob_property_snapshot'].includes(table)) throw Error(`Blocked preview read: ${table}`)
    let operation = 'read', values: unknown
    const execute = async () => {
      if (operation !== 'read') {
        if (!new URLSearchParams(location.search).has('actions')) throw Error('Preview writes are disabled')
        homeTest.writes.push({ table, operation, values })
        await new Promise(resolve => setTimeout(resolve, homeTest.delay))
        if (homeTest.createFailAt === table && operation !== 'delete') return { data: null, error: { message: 'Synthetic failure' } }
      }
      return { data: operation === 'insert' ? { id: table === 'properties' ? 'new-property' : 'new-inspection',
        owner: session.user.id, name: 'Syntetiskt uppdrag' } : [], error: null }
    }
    const builder = {
      insert: (value: unknown) => { operation = 'insert'; values = value; return builder },
      upsert: (value: unknown) => { operation = 'upsert'; values = value; return builder },
      delete: () => { operation = 'delete'; return builder },
      select: () => builder, eq: () => builder, is: () => builder, order: () => builder, limit: () => builder,
      single: execute,
      maybeSingle: async () => table === 'profiles' ? {
        data: new URLSearchParams(location.search).has('missing-profile') ? null : { full_name: 'Testperson', email: 'test@example.invalid', company_name: 'Testbolag' },
        error: null,
      } : ({ data: null, error: null }),
      then: (resolve: (value: unknown) => void) => execute().then(resolve),
    }
    return builder
  },
}
