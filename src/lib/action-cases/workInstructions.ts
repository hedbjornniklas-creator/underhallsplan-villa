import type { ActionCaseAttachmentView } from './contracts'

export const INSTRUCTION_MAX_FILES = 50
export const INSTRUCTION_MAX_TEXT = 12000
export type InstructionFileRef = { source: 'project' | 'diary'; id: string }
export type InstructionBody = { text: string; files: InstructionFileRef[] }
export type InstructionFile = ActionCaseAttachmentView & { source: InstructionFileRef['source']; sourceId: string; url: string }
export type InstructionVersion = { revision: number; body: InstructionBody; files: InstructionFile[]; createdAt: string; actorName: string }
export type InstructionWorkspace = { revision: number; body: InstructionBody; files: InstructionFile[]; projectFiles: ActionCaseAttachmentView[]; updatedAt: string | null; updatedBy: string; cacheScope: string; readOnly: boolean }
export type InstructionReceipt = { requestId: string; revision: number; createdAt: string; actorName: string; files: InstructionFile[] }
export const instructionUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const instructionFileKey = (file: InstructionFileRef) => file.source === 'diary' ? `diary:${file.id}` : file.id
function invalid(): never { throw new Error('WORK_INSTRUCTIONS_INVALID') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
export function normalizeInstructionBody(input: unknown): InstructionBody {
  const body = object(input)
  if (Object.keys(body).some(key => !['text', 'files'].includes(key)) || typeof body.text !== 'string' || body.text.length > INSTRUCTION_MAX_TEXT || body.text.includes('\0') || !Array.isArray(body.files) || body.files.length > INSTRUCTION_MAX_FILES) invalid()
  const files = body.files.map(value => {
    const file = object(value)
    if (Object.keys(file).some(key => !['source', 'id'].includes(key)) || !['project', 'diary'].includes(String(file.source)) || !instructionUuid(file.id)) invalid()
    return { source: file.source as InstructionFileRef['source'], id: file.id.toLowerCase() }
  })
  if (new Set(files.map(instructionFileKey)).size !== files.length) invalid()
  return { text: body.text, files }
}
export function instructionSaveRequest(input: unknown) {
  const data = object(input)
  if (Object.keys(data).some(key => !['requestId', 'revision', 'body'].includes(key)) || !instructionUuid(data.requestId) || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 || Number(data.revision) >= 2147483647) invalid()
  return { requestId: data.requestId.toLowerCase(), revision: Number(data.revision), body: normalizeInstructionBody(data.body) }
}
