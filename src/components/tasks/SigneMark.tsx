type SigneCheckIconProps = {
  size?: number
  className?: string
}

export function SigneCheckIcon({ size = 20, className }: SigneCheckIconProps) {
  return (
    <svg
      viewBox="0 0 1200 800"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <polyline
        points="170 430 430 630 1020 130"
        fill="none"
        stroke="currentColor"
        strokeWidth="92"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SigneMark() {
  return (
    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
      <SigneCheckIcon size={30} />
    </span>
  )
}
