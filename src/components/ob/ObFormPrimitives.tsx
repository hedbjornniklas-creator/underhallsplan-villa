import type { ReactNode } from 'react'

// Presentation only; each form retains its own persistence and locking rules.
export function ObFormSection({ title, children, className = '' }: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`ob-form-section ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function ObFormField({ label, id, children }: {
  label: string
  id: string
  children: ReactNode
}) {
  return (
    <div className="ob-form-field">
      <label htmlFor={id} className="ob-form-label">{label}</label>
      {children}
    </div>
  )
}
