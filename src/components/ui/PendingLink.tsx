'use client'

import Link from 'next/link'
import { LoaderCircle } from 'lucide-react'
import type { ComponentProps, MouseEvent, ReactNode } from 'react'

type PendingLinkProps = Omit<ComponentProps<typeof Link>, 'children'> & {
  children: ReactNode
  disabled?: boolean
  icon?: ReactNode
  pending?: boolean
  pendingIcon?: ReactNode
  pendingLabel?: ReactNode
}

export default function PendingLink({
  children,
  className = '',
  disabled = false,
  icon,
  onClick,
  pending = false,
  pendingIcon,
  pendingLabel,
  ...linkProps
}: PendingLinkProps) {
  const blocked = disabled || pending

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (blocked) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <Link
      {...linkProps}
      onClick={handleClick}
      aria-disabled={blocked || undefined}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 transition duration-150 active:scale-[0.98] active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 ${
        blocked ? 'pointer-events-none cursor-wait opacity-70 active:scale-100 active:brightness-100' : ''
      } ${className}`}
    >
      {pending
        ? pendingIcon ?? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        : icon}
      <span>{pending && pendingLabel !== undefined ? pendingLabel : children}</span>
    </Link>
  )
}

