'use client'

import { LoaderCircle } from 'lucide-react'
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'

type ActionButtonTone = 'blue' | 'emerald' | 'amber' | 'slate' | 'danger' | 'secondary' | 'emeraldSecondary'

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean
  busyLabel?: ReactNode
  icon?: ReactNode
  busyIcon?: ReactNode
  tone?: ActionButtonTone
}

const toneClassNames: Record<ActionButtonTone, string> = {
  blue: 'bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-400',
  emerald: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-400',
  amber: 'bg-amber-700 text-white hover:bg-amber-800 disabled:bg-amber-400',
  slate: 'bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-400',
  danger: 'bg-rose-700 text-white hover:bg-rose-800 disabled:bg-rose-400',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-500',
  emeraldSecondary:
    'border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 disabled:bg-stone-100 disabled:text-stone-500',
}

const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  {
    busy = false,
    busyLabel,
    icon,
    busyIcon,
    tone = 'slate',
    className = '',
    disabled,
    children,
    type = 'button',
    ...buttonProps
  },
  ref,
) {
  const isDisabled = disabled || busy

  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 transition duration-150 active:scale-[0.98] active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 disabled:opacity-60 disabled:active:scale-100 disabled:active:brightness-100 ${
        busy ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed'
      } ${toneClassNames[tone]} ${className}`}
    >
      {busy
        ? busyIcon ?? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        : icon}
      <span>{busy && busyLabel !== undefined ? busyLabel : children}</span>
    </button>
  )
})

export default ActionButton
