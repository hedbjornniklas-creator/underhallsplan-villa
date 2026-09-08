import type { FlowEdit, FlowMovePreview } from './flowEditor'

export async function requestFlowEdit(edit: FlowEdit, version?: string) {
  const response = await fetch('/api/renoapp/admin/flow-move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...edit, apply: Boolean(version), version }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Ändringen kunde inte bekräftas. Ladda om flödet.')
  if (!result.version || !result.itemLabel || (version && result.saved !== true)) {
    throw new Error('Svaret kunde inte bekräftas. Ladda om flödet.')
  }
  return result as FlowMovePreview
}
