import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { RECIPIENT_PORTAL_HOME } from './recipientAuthPaths'

/** Choose a start page for an existing recipient account; never grant access. */
export async function getCurrentUserRecipientEntryDestination() {
  try {
    const client = createSupabaseServerClient()
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user) return null

    // This existing service-only RPC checks active identity, confirmed email
    // and the current Auth email match. It also works with no assigned tasks.
    const admin = createSupabaseAdminClient()
    const { data: identityId, error } = await admin.rpc('recipient_session_identity', {
      p_auth_user_id: user.id,
    })
    if (error) {
      console.error('[access.recipient-entry] Could not resolve recipient account', { code: error.code })
      return null
    }
    return typeof identityId === 'string' && identityId.length > 0 ? RECIPIENT_PORTAL_HOME : null
  } catch {
    console.error('[access.recipient-entry] Recipient account lookup unavailable')
    return null
  }
}
