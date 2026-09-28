import Link from 'next/link'

export default function MoistureNotFound() {
  return <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
    <h1 className="text-2xl font-semibold">Projektet kunde inte hittas</h1>
    <p className="mt-3 text-base leading-7 text-slate-600">Kontrollera länken och att rätt arbetsorganisation är vald.</p>
    <Link href="/fuktsakerhet" className="mt-5 inline-block rounded px-1 py-2 font-semibold text-blue-700 underline focus-visible:outline-2">
      Till Fuktsäkerhet
    </Link>
  </main>
}
