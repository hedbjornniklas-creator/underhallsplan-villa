import React from 'react'

export default function Link({ children, ...props }: React.ComponentProps<'a'>) { return <a {...props}>{children}</a> }
export const useRouter = () => ({ refresh: () => undefined })
export const supabase = { auth: {
  getUser: async () => ({ data: { user: location.search.includes('wrong-user') ? { email: 'other@example.test' } : null } }),
  signInWithPassword: async ({ email }: { email: string }) => ({ data: { user: { email } }, error: null }),
  signOut: async () => ({ error: null }),
} }
