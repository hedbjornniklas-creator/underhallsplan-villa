const session = { user: { id: 'preview-user' } }
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: session.user }, error: null }),
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from(table: string) {
    if (table !== 'profiles') throw Error(`Blocked synthetic preview database access: ${table}`)
    const builder = {
      select: () => builder, eq: () => builder,
      maybeSingle: async () => ({ data: { full_name: 'Testperson', email: 'test@example.invalid', company_name: 'Testbolag' }, error: null }),
    }
    return builder
  },
}
