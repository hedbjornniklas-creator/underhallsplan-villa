// The comparison must read after blur/autosave has finished. Otherwise a delayed
// local contact save could replace the phone number just imported by the user.
const pending = new Map<string, Set<Promise<unknown>>>()
const failures = new Map<string, Set<string>>()

export class ObGrunddataWriteError extends Error {
  constructor() {
    super('En ändring i Grunddata kunde inte sparas. Stäng jämförelsen och spara den berörda uppgiften igen innan du för över kundens uppgifter.')
    this.name = 'ObGrunddataWriteError'
  }
}

export function recordObGrunddataWriteResult(inspectionId: string, fields: string[], failed: boolean) {
  const failedFields = failures.get(inspectionId) ?? new Set<string>()
  for (const field of fields) {
    if (failed) failedFields.add(field)
    else failedFields.delete(field)
  }
  if (failedFields.size) failures.set(inspectionId, failedFields)
  else failures.delete(inspectionId)
}

export function trackObGrunddataWrite<T>(inspectionId: string, task: () => Promise<T>): Promise<T> {
  const tasks = pending.get(inspectionId) ?? new Set<Promise<unknown>>()
  pending.set(inspectionId, tasks)
  const result = task().finally(() => {
    tasks.delete(result)
    if (!tasks.size) pending.delete(inspectionId)
  })
  tasks.add(result)
  return result
}

export async function waitForObGrunddataWrites(inspectionId: string) {
  while (pending.get(inspectionId)?.size) await Promise.all([...pending.get(inspectionId)!])
  if (failures.get(inspectionId)?.size) throw new ObGrunddataWriteError()
}
