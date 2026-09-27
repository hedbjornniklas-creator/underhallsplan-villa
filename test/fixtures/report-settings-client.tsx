import type { ReactNode } from 'react'

declare global { interface Window { profileSaves: Record<string, unknown>[] } }
window.profileSaves = []
export default function Stub({ children }: { children?: ReactNode }) { return children ?? null }
export function useRouter() { return { push() {}, back() {} } }
const profile = { id: 'owner', full_name: 'Testperson', email: 'test@example.se', company_name: 'Testbolag', company_website: null as string | null }
Object.assign(profile, JSON.parse(sessionStorage.getItem('report-test-profile') ?? '{}'))
export const supabase = {
  auth: { async getUser() { return { data: { user: { id: 'owner', email: profile.email } } } } },
  from(table: string) {
    let columns = ''
    const result = () => ({ data: table === 'profiles' ? profile : table === 'org_members' ? { org_id: 'test-org' } : [], error: null })
    const query = { select(value: string) { columns = value; return query }, eq() { return query }, order() { return query }, limit() { return query },
      async maybeSingle() {
        if (columns === 'company_website' && location.search.includes('missing-column')) return { data: null, error: { code: '42703', message: 'company_website does not exist' } }
        return result()
      },
      async upsert(value: Record<string, unknown>) { window.profileSaves.push(value); Object.assign(profile, value); sessionStorage.setItem('report-test-profile', JSON.stringify(profile)); return { error: null } },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve) },
    }
    return query
  },
}
