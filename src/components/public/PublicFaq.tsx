import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'

export default function PublicFaq({ items }: { items: { question: string; answer: ReactNode }[] }) {
  return <div className="public-faq">{items.map((item) => <details key={item.question}><summary>{item.question}<Plus size={20} aria-hidden="true" /></summary><div className="public-faq-answer">{item.answer}</div></details>)}</div>
}
