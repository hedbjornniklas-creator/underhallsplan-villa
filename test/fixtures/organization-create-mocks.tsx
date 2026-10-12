import React from 'react'
export default function Link({ children, ...props }: React.ComponentProps<'a'>) { return <a {...props}>{children}</a> }
export const usePathname = () => '/settings/organisation/skapa'
export const useSearchParams = () => new URLSearchParams()
