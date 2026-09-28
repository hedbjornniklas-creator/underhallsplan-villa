import Link from 'next/link'

export default function WorkspaceError({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
      <section className="rounded-md border border-rose-200 bg-rose-50 p-6 text-rose-950" role="alert">
        <h1 className="text-xl font-semibold">Fuktsäkerhet kunde inte öppnas</h1>
        <p className="mt-3 text-base leading-7">{message}</p>
        <Link className="mt-5 inline-block rounded px-1 py-2 font-semibold underline focus-visible:outline-2" href="/dashboard-v1">
          Till arbetsområden
        </Link>
      </section>
    </main>
  )
}
