import type { ComponentProps, MouseEvent } from 'react'

export default function MoisturePreviewLink({ href, onClick, target, ...props }: ComponentProps<'a'>) {
  const path = href?.split('?')[0] ?? '/'
  const localHref = path.startsWith('/fuktsakerhet/projekt/') ? '/?detail'
    : path === '/fuktsakerhet' || path === '/dashboard-v1' ? '/' : '/?register'
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (event.defaultPrevented || target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    window.dispatchEvent(new CustomEvent('preview-navigation', { detail: href }))
  }
  return <a {...props} href={localHref} target={target} onClick={navigate} />
}
