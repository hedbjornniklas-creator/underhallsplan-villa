export const usePathname = () => window.location.pathname
export const useParams = () => ({ token: 'brand-test', slug: 'brand-test' })
export const useSearchParams = () => new URLSearchParams(window.location.search)
export const useRouter = () => ({
  replace: (href: string) => { window.location.href = href },
  push: (href: string) => { window.location.href = href },
  refresh: () => {},
})
