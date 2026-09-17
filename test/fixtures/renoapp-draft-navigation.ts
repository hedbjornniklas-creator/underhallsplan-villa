import { useSyncExternalStore } from 'react'

const replace = window.history.replaceState.bind(window.history)
window.history.replaceState = (...args) => {
  replace(...args)
  window.dispatchEvent(new Event('popstate'))
}
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify)
  return () => window.removeEventListener('popstate', notify)
}
export const useParams = () => ({ slug: 'test' })
export const useSearchParams = () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search))
export const useRouter = () => ({ replace: (url: string) => window.location.replace(url), push: (url: string) => window.location.assign(url) })
