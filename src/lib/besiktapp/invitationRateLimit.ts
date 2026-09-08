// Instance-local brake only. Production activation additionally requires an edge/WAF limit.
export function createInvitationRateLimit() {
  const entries = new Map<string, { count: number; until: number }>()
  let total = { count: 0, until: 0 }
  return (key: string, now = Date.now()) => {
    for (const [id, entry] of entries) if (entry.until <= now) entries.delete(id)
    if (total.until <= now) total = { count: 0, until: now + 60000 }
    if (total.count >= 120) return false
    const entry = entries.get(key) ?? { count: 0, until: now + 600000 }
    if (entry.count >= 20 || (!entries.has(key) && entries.size >= 1000)) return false
    entry.count++; total.count++; entries.set(key, entry); return true
  }
}
