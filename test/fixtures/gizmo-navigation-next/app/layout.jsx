import '@/app/globals.css'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
export default function Layout({ children }) {
  return <html lang="sv"><body><AppToastProvider>{children}</AppToastProvider></body></html>
}
