import { ArrowRight } from 'lucide-react'

const steps = [
  {
    title: 'Styrelsen granskar',
    description: 'Styrelsen går igenom din ansökan.',
  },
  {
    title: 'Du kompletterar vid behov',
    description: 'Du får veta vilka uppgifter och handlingar du behöver lägga till.',
  },
  {
    title: 'Du får ett beslut',
    description: 'Godkännande, godkännande med villkor eller avslag.',
  },
]

export default function ResidentApplicationProcess() {
  return (
    <section aria-labelledby="application-process-title" className="mt-6 border-t border-stone-200 pt-5">
      <h2 id="application-process-title" className="text-base font-semibold text-stone-900">Efter att du skickat in</h2>
      <ol className="mt-3 grid gap-3 md:grid-cols-3 md:gap-6">
        {steps.map((item, index) => (
          <li key={item.title} className="relative rounded-2xl border border-stone-200 bg-white/80 px-4 py-3">
            <h3 className="text-sm font-semibold text-stone-900">{item.title}</h3>
            <p className="mt-1 text-sm leading-6 text-stone-600">{item.description}</p>
            {index < steps.length - 1 && <ArrowRight aria-hidden="true" size={16} className="absolute -right-5 top-1/2 hidden -translate-y-1/2 text-stone-400 md:block" />}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm text-stone-600">Efter en komplettering granskar styrelsen ansökan igen.</p>
    </section>
  )
}
