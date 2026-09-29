import type { ReactNode } from 'react'
import UppdragBrand from './UppdragBrand'
import './uppdrag-theme.css'

export default function UppdragScope({ children, external = false }: { children: ReactNode; external?: boolean }) {
  return (
    <div className="uppdrag-scope uppdrag-page">
      {external ? <header className="uppdrag-external-header"><UppdragBrand /></header> : null}
      {children}
    </div>
  )
}
