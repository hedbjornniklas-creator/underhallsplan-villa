import { AlertTriangle } from 'lucide-react'
import type { AssignmentLinkIssues } from '@/lib/assignments/linkIncidents'

export function AssignmentLinkIssueNotice({ issues }: { issues: AssignmentLinkIssues | null }) {
  if (!issues) return null
  if (!issues.available) return <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Status för tekniska länkfel kunde inte hämtas.</p>
  if (issues.items.length === 0) return null
  return <section aria-label="Tekniska länkfel" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle size={18} aria-hidden />Tekniskt fel registrerat på kundlänken</h2>
    {issues.items.map(issue => <div key={issue.id} className="space-y-1">
      <p>{issue.operation === 'open' ? 'Uppdragsbekräftelsen kunde inte öppnas.' : 'Godkännandet kunde inte bekräftas.'} Senast {new Date(issue.last_failed_at).toLocaleString('sv-SE')}.</p>
      <p className="break-all">Felreferens: {issue.last_reference}</p>
      {issue.notification_state === 'failed' ? <p>Mejlvarningen kunde inte bekräftas som skickad.</p> : null}
    </div>)}
  </section>
}

export function AssignmentLinkIssueBadge() {
  return <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-900"><AlertTriangle size={14} aria-hidden />Länkfel registrerat</span>
}
