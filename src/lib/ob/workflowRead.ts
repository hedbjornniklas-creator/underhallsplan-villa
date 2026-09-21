export const OB_WORKFLOW_READ_TIMEOUT_MS = 15000
export const OB_WORKFLOW_CONNECTION_ERROR = 'Kunde inte kontrollera uppdragsstatus. Kontrollera anslutningen och försök igen.'
export class ObWorkflowAccessError extends Error {}

// The deadline also covers waiting for local writes and reading the response
// body. Cancellation never retries or aborts an inspection mutation.
export function startObWorkflowRead<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = OB_WORKFLOW_READ_TIMEOUT_MS) {
  const controller = new AbortController()
  let cancel!: () => void
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort()
      reject(new Error(OB_WORKFLOW_CONNECTION_ERROR))
    }
  })
  const timer = setTimeout(() => cancel(), timeoutMs)
  const promise = Promise.race([Promise.resolve().then(() => work(controller.signal)), deadline])
    .finally(() => clearTimeout(timer))
  return { promise, cancel, startedAt: Date.now() }
}
