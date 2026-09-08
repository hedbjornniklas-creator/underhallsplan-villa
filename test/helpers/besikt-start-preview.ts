// Read-only mock: no real accounts, database calls or credentials.
export const supabase = {
  auth: { async getUser() { return { data: { user: { id: new URLSearchParams(location.search).get('user') || 'fictional-user' } }, error: null } } },
  from(table: string) {
    if (table !== 'profiles') throw new Error('Unexpected table')
    return { select() { return { eq(column: string, value: string) {
      if (column !== 'id' || !value) throw new Error('Profile must be scoped to current user')
      return { async maybeSingle() {
        const scenario = new URLSearchParams(location.search).get('scenario')
        return { data: scenario === 'complete' ? { full_name: 'Testperson', email: 'person@example.test', company_name: 'Testbolag' } : { full_name: 'Testperson', email: 'person@example.test', company_name: '' }, error: scenario === 'error' ? { message: 'Simulated read failure' } : null }
      } }
    } } } }
  },
}
