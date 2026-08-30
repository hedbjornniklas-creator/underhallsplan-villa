import { LoaderCircle } from 'lucide-react'

export default function TuLoading() {
  return (
    <main
      className="mx-auto flex min-h-[50vh] w-full max-w-6xl items-center justify-center px-4 py-12"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-white px-5 py-4 text-sm font-semibold text-violet-900 shadow-sm">
        <LoaderCircle className="h-5 w-5 animate-spin text-violet-600" aria-hidden="true" />
        Öppnar teknisk utredning...
      </div>
    </main>
  )
}
