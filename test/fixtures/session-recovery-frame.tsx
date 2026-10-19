import type { ReactNode } from 'react'

// Keep surrounding public chrome synthetic; the actual PublicLogin component
// and its sign-in subscription/return destination run unchanged.
export default function SyntheticPublicFrame({ children }: { children: ReactNode }) {
  return <main style={{ margin: '32px auto', padding: '24px', maxWidth: '640px' }}>{children}</main>
}
