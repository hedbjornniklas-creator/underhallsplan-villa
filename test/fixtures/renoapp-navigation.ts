const router = { replace: () => {}, push: () => {} }
export const useParams = () => ({ slug: 'test' })
export const useRouter = () => router
export const useSearchParams = () => new URLSearchParams('draft=fixture-secret')
