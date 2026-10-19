import { supabase } from './session-recovery-client'

// Emulate only the auth result; never collect credentials or send a request.
export default function SyntheticPasswordPanel() {
  return <button type="button" onClick={() => void supabase.auth.signInWithPassword()}>Slutför syntetisk inloggning</button>
}
