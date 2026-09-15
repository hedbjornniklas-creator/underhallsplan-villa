export const usePathname = () => window.location.pathname
export const useParams = () => ({ token: 'brand-test', slug: 'brand-test', id: 'brand-case' })
export const useSearchParams = () => new URLSearchParams(window.location.search)
const router = {
  replace: (href: string) => { window.location.href = href },
  push: (href: string) => { window.location.href = href },
  refresh: () => {},
}
export const useRouter = () => router
