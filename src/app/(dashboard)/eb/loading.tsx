import { Loader2 } from 'lucide-react'

export default function EbLoading() {
  return (
    <main
      className="relative flex min-h-[55vh] items-center justify-center px-4 py-16"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="fixed inset-x-0 top-0 z-[500] h-1 overflow-hidden bg-emerald-100">
        <div className="h-full w-2/3 animate-pulse bg-emerald-600" />
      </div>
      <div className="inline-flex items-center gap-3 rounded-lg border border-emerald-100 bg-white px-5 py-4 text-sm font-semibold text-emerald-900 shadow-lg">
        <Loader2 size={20} className="animate-spin" />
        Öppnar EB...
      </div>
    </main>
  )
}
