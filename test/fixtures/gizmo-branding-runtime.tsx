export const supabase = { auth: { getUser: async () => ({ data: { user: { email: 'anna@example.test' } } }), signOut: async () => {} } }
export function useProfile() { return { profile: { full_name: 'Anna Exempel' } } }
export function usePathname() { return '/uppdrag' }
export function useRouter() { return { replace() {}, push() {}, refresh() {} } }
export function useSearchParams() { return new URLSearchParams() }
export default function EmptyOrganizationSwitcher() { return null }
