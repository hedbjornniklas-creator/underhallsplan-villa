// Deliberately isolated: no real authentication or persistent credentials.
let user: { email: string } | null = null
export const supabase = { auth: {
  async getUser() { return { data: { user }, error: null } },
  async signInWithPassword({ email }: { email: string; password: string }) { user = { email }; return { data: { user }, error: null } },
  async signOut() { user = null; return { error: null } },
} }
