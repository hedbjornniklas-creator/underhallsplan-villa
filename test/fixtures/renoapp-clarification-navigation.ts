const router = { replace: () => {}, push: () => {} }
export const useParams = () => ({ slug: 'test', id: 'case' })
export const useRouter = () => router
export const useSearchParams = () => new URLSearchParams('draft=fixture-secret')
