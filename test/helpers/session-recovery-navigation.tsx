import type { ComponentProps } from 'react'

export default function PreviewLink({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) {
  void _prefetch
  return <a {...props} />
}
const router = {
  replace(path: string) { window.location.replace(path) },
  refresh() { window.location.reload() },
}
export function useRouter() { return router }
