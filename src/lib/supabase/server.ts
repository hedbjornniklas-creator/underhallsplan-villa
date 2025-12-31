import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

export function createSupabaseServerClient() {
  const cookieStorePromise = cookies()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Sätt NEXT_PUBLIC_SUPABASE_URL och NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  const resolveStore = async () => {
    const store = await Promise.resolve(cookieStorePromise as any)
    return store as any
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      async getAll() {
        const store: any = await resolveStore()
        return store.getAll ? store.getAll() : []
      },
      async setAll(cookiesToSet) {
        const store: any = await resolveStore()
        cookiesToSet.forEach(({ name, value, options }) => {
          if (store.set) {
            store.set(name, value, options)
          }
        })
      },
    },
  })
}
