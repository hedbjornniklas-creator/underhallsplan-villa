type NoteOrderSource = {
  id: string
  sortOrder?: number | null
  noteNumber?: number | null
  createdAt?: string | null
}

type CheckpointOrderSource = {
  noteId?: string | null
  groupKey?: string | null
  sortOrder?: number | null
  title: string
}

/** The report's display order, not the database's original note numbers. */
export function sortEbReportNotes<T extends NoteOrderSource>(notes: readonly T[]): T[] {
  return [...notes].sort((left, right) => {
    if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    if ((left.noteNumber ?? 0) !== (right.noteNumber ?? 0)) return (left.noteNumber ?? 0) - (right.noteNumber ?? 0)
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

/** Number the complete frozen report before filtering follow-up tasks or recipients. */
export function ebReportNoteDisplayIndex(report: {
  notes: readonly NoteOrderSource[]
  project?: { projectTemplateKey?: string | null }
  checkpoints?: readonly CheckpointOrderSource[]
}): Map<string, number> {
  if (report.project?.projectTemplateKey !== 'drainage_foundation') {
    return new Map(sortEbReportNotes(report.notes).map((note, index) => [note.id, index + 1]))
  }
  return ebReportCheckpointDisplayIndex(report.checkpoints ?? [])
}

export function ebReportCheckpointDisplayIndex(source: readonly CheckpointOrderSource[]): Map<string, number> {
  // Drainage reports show grouped control points in place of the ordinary note
  // list. Match the actual checklist numbering, including points without notes.
  const groups = new Map<string, CheckpointOrderSource[]>()
  const checkpoints = [...source].filter(item => item.groupKey !== 'documents').sort((left, right) =>
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.title.localeCompare(right.title, 'sv-SE'))
  for (const checkpoint of checkpoints) {
    const groupKey = checkpoint.groupKey || 'other'
    const group = groups.get(groupKey) ?? []
    group.push(checkpoint)
    groups.set(groupKey, group)
  }
  const numbers = new Map<string, number>()
  let number = 0
  for (const group of groups.values()) for (const checkpoint of group) {
    number += 1
    if (checkpoint.noteId) numbers.set(checkpoint.noteId, number)
  }
  return numbers
}
