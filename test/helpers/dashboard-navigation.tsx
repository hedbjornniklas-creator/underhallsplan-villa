import { useMemo, useSyncExternalStore } from 'react'
import type { ComponentProps } from 'react'

export default function PreviewLink({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) {
  void _prefetch
  return <a {...props} />
}
function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}
export function useSearchParams() {
  const query = useSyncExternalStore(subscribe, () => location.search)
  return useMemo(() => new URLSearchParams(query), [query])
}
