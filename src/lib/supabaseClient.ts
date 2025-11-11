// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js'

// Här kopplas projektet till ditt Supabase-konto.
// Supabase-url och nyckel hämtas från filen .env.local

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
