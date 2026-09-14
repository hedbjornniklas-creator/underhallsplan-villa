export const supabase = { auth: {
  getSession: async () => ({ data: { session: null } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({ error: null }),
  signInWithPassword: async () => ({ error: new Error('Invalid login credentials') }),
  resetPasswordForEmail: async () => ({ data: {}, error: null }),
} }
