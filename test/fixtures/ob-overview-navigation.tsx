import type { ComponentProps, ReactNode } from 'react'

export default function PreviewLink({ href, children, prefetch: _prefetch, ...props }: Omit<ComponentProps<'a'>, 'href'> & {
  href: string; children: ReactNode; prefetch?: boolean
}) {
  void _prefetch
  return <a href={href} {...props}>{children}</a>
}
export function useRouter() { return { push() {}, replace() {}, refresh() {} } }
