import type { Metadata } from 'next'
import { getRfqPublicView } from '@/lib/action-cases/rfqDeliveryServer'
import ActionCaseRfqFiles from '@/components/tasks/ActionCaseRfqFiles'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Offertunderlag | HusHub', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function RfqPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let delivery, failed = false
  try { delivery = await getRfqPublicView(token) } catch { failed = true }
  if (!delivery) return <main className="mx-auto max-w-xl px-5 py-12 text-slate-950"><h1 className="text-2xl font-semibold">{failed ? 'Offertunderlaget kunde inte hämtas' : 'Länken är inte tillgänglig'}</h1><p className="mt-4 text-slate-600">{failed ? 'Försök igen om en stund.' : 'Länken kan ha gått ut eller återkallats. Kontakta avsändaren för aktuellt underlag.'}</p></main>
  return <main className="mx-auto min-h-dvh max-w-5xl bg-white px-5 text-slate-950 sm:px-8">
    <header className="border-b border-slate-200 py-7"><p className="text-sm font-semibold text-violet-700">HusHub · Offertunderlag</p><h1 className="mt-3 break-words text-2xl font-semibold">{delivery.subject}</h1><p className="mt-2 break-words text-slate-600">{delivery.propertyAddress}</p><div className="mt-4 flex flex-wrap justify-between gap-2 text-sm text-slate-500"><span className="break-words">Till {delivery.supplierName}</span><span>Giltigt till {new Date(delivery.expiresAt).toLocaleDateString('sv-SE')}</span></div></header>
    <article className="whitespace-pre-wrap break-words py-7 text-sm leading-7">{delivery.body}</article>
    <ActionCaseRfqFiles files={delivery.files} token={token} />
  </main>
}
