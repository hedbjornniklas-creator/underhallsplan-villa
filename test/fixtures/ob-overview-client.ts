// Synthetic dashboard reads only. No credentials or mutations in this preview.
const session = { user: { id: 'preview-user' } }
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: session.user }, error: null }),
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from(table: string) {
    if (!['properties', 'profiles', 'assignments'].includes(table)) throw Error(`Blocked preview read: ${table}`)
    const builder = {
      select: () => builder, eq: () => builder, is: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return builder
  },
}
