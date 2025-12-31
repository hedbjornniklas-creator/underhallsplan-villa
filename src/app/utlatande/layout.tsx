import type { ReactNode } from 'react'

export default function UtlatandeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-100 print:bg-white">
      <div className="flex justify-center">
        <div className="w-full">{children}</div>
      </div>
    </div>
  )
}
