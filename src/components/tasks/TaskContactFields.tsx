'use client'
export type TaskContactDraft = { name: string; companyName: string; email: string; phone: string }
export default function TaskContactFields({ value, onChange, className }: { value: TaskContactDraft; onChange: (value: TaskContactDraft) => void; className: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">{([['name', 'Namn', 'text'], ['companyName', 'Företag', 'text'], ['email', 'E-post för Mina uppdrag', 'email'], ['phone', 'Telefon / WhatsApp', 'tel']] as const).map(([key, label, type]) => <label className="block" key={key}>{label}<input className={className} type={type} required={key === 'name' || key === 'email'} maxLength={key === 'email' ? 320 : 250} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} /></label>)}</div>
}
