export type FlowNodeTone = 'stone' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

export type FlowNodeRef =
  | { type: 'actionType'; actionTypeId: string }
  | { type: 'rootQuestion'; actionTypeId: string; questionId: string }
  | { type: 'rootRequirement'; actionTypeId: string; documentTypeId: string }
  | { type: 'rootParticipant'; actionTypeId: string; participantRoleId: string }
  | { type: 'question'; questionId: string }
  | { type: 'option'; questionId: string; optionId: string }
  | { type: 'optionQuestionTrigger'; questionId: string; optionId: string; targetQuestionId: string }
  | { type: 'optionDocumentTrigger'; questionId: string; optionId: string; targetDocumentTypeId: string }
  | { type: 'optionParticipantTrigger'; questionId: string; optionId: string; targetParticipantRoleId: string }
  | { type: 'optionReviewFlagTrigger'; questionId: string; optionId: string; targetReviewFlagId: string }
  | { type: 'actionTypeReviewFlag'; actionTypeId: string; targetReviewFlagId: string }
  | { type: 'documentReviewFlag'; documentTypeId: string; targetReviewFlagId: string }
  | { type: 'participantReviewFlag'; participantRoleId: string; targetReviewFlagId: string }
  | { type: 'status' }

export type FlowTarget = { kind: 'action' | 'option' | 'document' | 'participant'; id: string }
export type FlowSource = {
  kind: 'action_question' | 'action_document' | 'action_participant' | 'option_trigger' | 'flag_link'
  id: string
  parentId: string
}
export type FlowMove = { source: FlowSource; target: FlowTarget }
export type FlowEdit = { source: FlowSource } & (
  | { operation: 'move' | 'copy'; target: FlowTarget }
  | { operation: 'remove'; target?: never }
)
export type FlowMovePreview = {
  version: string
  itemLabel: string
  fromLabel: string
  toLabel: string
  shared: boolean
}

export type FlowNode = {
  id: string
  kind: 'root' | 'question' | 'option' | 'document' | 'participant' | 'flag' | 'status'
  title: string
  badges: string[]
  tone: FlowNodeTone
  children: FlowNode[]
  ref: FlowNodeRef
  source?: FlowSource
}

export function flowTarget(node: FlowNode): FlowTarget | null {
  const ref = node.ref
  if (ref.type === 'actionType') return { kind: 'action', id: ref.actionTypeId }
  if (ref.type === 'option') return { kind: 'option', id: ref.optionId }
  if (ref.type === 'rootRequirement') return { kind: 'document', id: ref.documentTypeId }
  if (ref.type === 'optionDocumentTrigger') return { kind: 'document', id: ref.targetDocumentTypeId }
  if (ref.type === 'rootParticipant') return { kind: 'participant', id: ref.participantRoleId }
  if (ref.type === 'optionParticipantTrigger') return { kind: 'participant', id: ref.targetParticipantRoleId }
  return null
}

export function canDropFlowNode(node: FlowNode, target: FlowNode) {
  const destination = flowTarget(target)
  if (!node.source || !destination || node.id === target.id) return false
  if (node.source.parentId === destination.id) return false
  if (destination.kind === 'document' || destination.kind === 'participant') return node.kind === 'flag'
  return ['question', 'document', 'participant', 'flag'].includes(node.kind)
}

export function flowQuestionId(node: FlowNode): string | null {
  const ref = node.ref
  if (ref.type === 'rootQuestion' || ref.type === 'question') return ref.questionId
  if (ref.type === 'optionQuestionTrigger') return ref.targetQuestionId
  return null
}

export function canChooseFlowTarget(source: FlowNode, target: FlowNode, operation: 'move' | 'copy') {
  if (!['move', 'copy'].includes(operation) || !canDropFlowNode(source, target)) return false
  // Reuse links to the same entity, not a new definition. An existing direct
  // child already satisfies the connection, regardless of its visual occurrence.
  if (target.children.some(child => flowEntityKey(child) === flowEntityKey(source))) return false
  // Shared questions can be drawn more than once. Exclude descendants by entity,
  // not only by their visual occurrence, so a copied branch cannot loop back.
  const targetQuestion = flowQuestionId(target) ?? (target.ref.type === 'option' ? target.ref.questionId : null)
  if (!targetQuestion) return true
  const containsQuestion = (node: FlowNode): boolean => flowQuestionId(node) === targetQuestion || node.children.some(containsQuestion)
  return !containsQuestion(source)
}

function flowEntityKey(node: FlowNode): string {
  const ref = node.ref
  const question = flowQuestionId(node)
  if (question) return `question:${question}`
  if (ref.type === 'rootRequirement') return `document:${ref.documentTypeId}`
  if (ref.type === 'optionDocumentTrigger') return `document:${ref.targetDocumentTypeId}`
  if (ref.type === 'rootParticipant') return `participant:${ref.participantRoleId}`
  if (ref.type === 'optionParticipantTrigger') return `participant:${ref.targetParticipantRoleId}`
  if ('targetReviewFlagId' in ref) return `flag:${ref.targetReviewFlagId}`
  return node.id
}

export type FlowOccurrence = { id: string; node: FlowNode; parentId: string | null }

export function flattenFlow(root: FlowNode, expandedIds: string[] | null): FlowOccurrence[] {
  const rows: FlowOccurrence[] = []
  const visit = (node: FlowNode, parentId: string | null, ancestry: string[]) => {
    // A shared question can occur under several answers. Each drawing needs its own ID.
    const path = [...ancestry, node.id]
    const id = JSON.stringify(path)
    rows.push({ id, node, parentId })
    if (!parentId || expandedIds === null || expandedIds.includes(node.id)) node.children.forEach(child => visit(child, id, path))
  }
  visit(root, null, [])
  return rows
}

export function flowSubtreeIds(rows: FlowOccurrence[], rootId: string) {
  const children = new Map<string, string[]>()
  for (const row of rows) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id])
  const result = new Set<string>()
  const visit = (id: string) => {
    if (result.has(id)) return
    result.add(id)
    children.get(id)?.forEach(visit)
  }
  visit(rootId)
  return result
}

export function parseFlowMove(value: unknown): FlowMove & { version: string | null; apply: boolean } {
  const edit = parseFlowEdit(value)
  if (edit.operation !== 'move') throw new Error('FLOW_MOVE_INVALID')
  return { source: edit.source, target: edit.target, version: edit.version, apply: edit.apply }
}

export function parseFlowEdit(value: unknown): FlowEdit & { version: string | null; apply: boolean } {
  if (!value || typeof value !== 'object') throw new Error('FLOW_MOVE_INVALID')
  const body = value as Record<string, unknown>
  const operation = body.operation === undefined ? 'move' : body.operation
  const source = body.source as Partial<FlowSource> | null
  const target = body.target as Partial<FlowTarget> | null
  const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  if ((operation !== 'move' && operation !== 'copy' && operation !== 'remove')
    || !source || !uuid(source.id) || !uuid(source.parentId)
    || !['action_question', 'action_document', 'action_participant', 'option_trigger', 'flag_link'].includes(source.kind ?? '')
    || (body.apply !== undefined && typeof body.apply !== 'boolean')
    || (body.apply === true && (typeof body.version !== 'string' || !/^[a-f0-9]{32}$/.test(body.version)))) {
    throw new Error('FLOW_MOVE_INVALID')
  }
  const common = { source: source as FlowSource, apply: body.apply === true,
    version: typeof body.version === 'string' ? body.version : null }
  if (operation === 'remove') {
    if (body.target !== undefined) throw new Error('FLOW_MOVE_INVALID')
    return { ...common, operation }
  }
  if ((operation !== 'move' && operation !== 'copy') || !target || !uuid(target.id)
    || !['action', 'option', 'document', 'participant'].includes(target.kind ?? '')) throw new Error('FLOW_MOVE_INVALID')
  return { ...common, operation, target: target as FlowTarget }
}
