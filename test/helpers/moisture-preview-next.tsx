import type { ComponentProps } from 'react'

export function useRouter() {
  return {
    push(href: string) { window.dispatchEvent(new CustomEvent('preview-navigation', { detail: href })) },
    refresh() { window.location.reload() },
  }
}

export default function PreviewImage({ priority: _priority, ...props }: ComponentProps<'img'> & { priority?: boolean }) {
  void _priority
  // eslint-disable-next-line @next/next/no-img-element -- Isolated fixture; Next's image server is not running.
  return <img {...props} alt={props.alt ?? ''} />
}
