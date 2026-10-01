// A save acknowledges its submitted snapshot, never edits made while it was in flight.
export function retainNewerDraft<T>(current: T, submitted: T, saved: T): T {
  return JSON.stringify(current) === JSON.stringify(submitted) ? saved : current
}
