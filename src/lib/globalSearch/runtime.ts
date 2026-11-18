import type { GlobalSearchExecution } from './model'

export class GlobalSearchTimeout extends Error {
  constructor() { super('GLOBAL_SEARCH_TIMEOUT') }
}
export class GlobalSearchAborted extends Error {
  constructor() { super('GLOBAL_SEARCH_ABORTED') }
}

/** One request only. Shared concurrency and cancellation for all search providers. */
export function createGlobalSearchExecution(parent?: AbortSignal, timeoutMs = 12000, concurrency = 4): GlobalSearchExecution & { dispose(): void } {
  const controller = new AbortController()
  const { signal } = controller
  const abort = () => controller.abort(new GlobalSearchAborted())
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new GlobalSearchTimeout()), timeoutMs)
  timer.unref?.()
  const queue: Array<{ grant(): void }> = []
  let active = 0
  const check = () => { if (signal.aborted) throw signal.reason }
  function acquire(): Promise<void> {
    check()
    if (active < concurrency) { active++; return Promise.resolve() }
    return new Promise((resolve, reject) => {
      const entry = { grant: () => { signal.removeEventListener('abort', cancel); resolve() } }
      const cancel = () => {
        const index = queue.indexOf(entry)
        if (index >= 0) queue.splice(index, 1)
        reject(signal.reason)
      }
      queue.push(entry)
      signal.addEventListener('abort', cancel, { once: true })
    })
  }
  function release() {
    const next = queue.shift()
    if (next) next.grant()
    else active--
  }
  return {
    signal, check,
    async run<T>(work: () => Promise<T>): Promise<T> {
      await acquire()
      let detach = () => {}
      try {
        check()
        const interrupted = new Promise<never>((_resolve, reject) => {
          const listener = () => reject(signal.reason)
          signal.addEventListener('abort', listener, { once: true })
          detach = () => signal.removeEventListener('abort', listener)
        })
        return await Promise.race([work(), interrupted])
      } finally { detach(); release() }
    },
    dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort) },
  }
}
