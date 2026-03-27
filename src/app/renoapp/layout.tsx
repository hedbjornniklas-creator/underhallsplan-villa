import type { ReactNode } from 'react'

export const metadata = {
  title: 'RenoApp',
  description: 'RenoApp MVP for BRF renovation applications',
}

export default function RenoAppLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[linear-gradient(180deg,#f5efe6_0%,#f4f1eb_52%,#fbfaf8_100%)] text-stone-900">{children}</div>
}
