'use client'

import Link from 'next/link'
import { LoaderCircle } from 'lucide-react'
import { useState, type ComponentProps, type MouseEvent, type ReactNode } from 'react'

type PendingLinkProps = Omit<ComponentProps<typeof Link>, 'children'> & {
  children: ReactNode
  autoPending?: boolean
  disabled?: boolean
  icon?: ReactNode
  pending?: boolean
  pendingIcon?: ReactNode
  pendingLabel?: ReactNode
}

export default function PendingLink({
  autoPending = false,
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
  const [navigationPending, setNavigationPending] = useState(false)
  const isPending = pending || navigationPending
  const blocked = disabled || isPending

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (blocked) {
      event.preventDefault()
      return
    }
    onClick?.(event)
    if (
      autoPending &&
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      linkProps.target !== '_blank'
    ) {
      setNavigationPending(true)
    }
  }

  return (
    <Link
      {...linkProps}
      onClick={handleClick}
      aria-disabled={blocked || undefined}
      aria-busy={isPending || undefined}
      className={`inline-flex items-center justify-center gap-2 transition duration-150 active:scale-[0.98] active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 ${
        blocked ? 'pointer-events-none cursor-wait opacity-70 active:scale-100 active:brightness-100' : ''
      } ${className}`}
    >
      {isPending
        ? pendingIcon ?? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        : icon}
      <span>{isPending && pendingLabel !== undefined ? pendingLabel : children}</span>
    </Link>
  )
}
