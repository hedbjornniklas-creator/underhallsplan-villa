import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Download } from 'lucide-react'
import { getRenoAppConsultantCaseDetail } from '@/lib/renoapp/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Konsultgranskning | RenoApp', robots: { index: false, follow: false } }
const date = (value: string | null) => value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }) : 'Ej angivet'
const statusLabels: Record<string, string> = {
  submitted: 'Ny ansökan', new_application: 'Ny ansökan', review: 'Att granska', need_info: 'Inväntar komplettering',
  approved: 'Godkänd', conditional: 'Godkänd med villkor', rejected: 'Avslagen', draft: 'Utkast',
}
const sectionClass = 'min-w-0 border-t border-stone-200 py-6'
const headingClass = 'mb-4 text-lg font-semibold text-stone-950'

export default async function ConsultantReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound()
  let result: Awaited<ReturnType<typeof getRenoAppConsultantCaseDetail>>
  try { result = await getRenoAppConsultantCaseDetail(id) }
  catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') redirect(`/login?next=${encodeURIComponent(`/renoapp/review/${id}`)}`)
    if (message === 'REVIEW_NOT_FOUND' || message === 'CASE_NOT_FOUND') notFound()
    if (message === 'FORBIDDEN' || message.includes('ACCESS') || message === 'PROFILE_NOT_FOUND') {
      return <main className="mx-auto max-w-3xl bg-white p-8"><h1 className={headingClass}>Åtkomst nekad</h1><p>Ditt konto saknar administratörsbehörighet för RenoApp. Logga ut innan du byter konto.</p><Link className="mt-4 inline-block underline" href="/app">Till HusHub</Link></main>
    }
    throw error
  }
  const { item, order } = result
  if (!item) notFound()
  // Include stored answers even when their question/option is no longer active.
  const answersResult = await createSupabaseAdminClient().from('renoapp_case_question_answers')
    .select('id,renoapp_apply_questions(label),renoapp_apply_question_options(label)').eq('case_id', id)
  if (answersResult.error) throw new Error('Kunde inte läsa svaren i ansökan.')
  const brfResult = await createSupabaseAdminClient().from('brf_associations')
    .select('org_number,address,postal_code,city,invoice_address,invoice_email,invoice_reference')
    .eq('id', order.brf_id).single()
  if (brfResult.error) throw new Error('Kunde inte läsa föreningsuppgifterna.')
  const brf = brfResult.data
  const relationLabel = (value: unknown) => {
    const relation = Array.isArray(value) ? value[0] : value
    return relation && typeof relation === 'object' && 'label' in relation ? String(relation.label) : 'Ej angivet'
  }
  const fileUrl = (fileId: string) => `/api/renoapp/review/${id}/files/${fileId}`
  const acceptance = item.rulesAcceptance
  return (
    <main className="mx-auto max-w-5xl bg-white px-5 py-8 text-sm leading-6 sm:px-8 [overflow-wrap:anywhere]">
      <header className="pb-6">
        <p className="text-sm font-semibold text-emerald-800">Konsultgranskning · Läsvy</p>
        <h1 className="mt-2 text-2xl font-semibold">{item.caseNumber} · {item.brf.name}</h1>
        <p className="mt-2 text-base">{item.title}</p>
        <p className="mt-2 text-stone-600">{statusLabels[item.status] ?? item.status} · Senast uppdaterad {date(item.updatedAt)}</p>
      </header>
      <section className={sectionClass}>
        <h2 className={headingClass}>Beställning</h2>
        <p className="font-semibold">{(order.price_ore / 100).toLocaleString('sv-SE')} kr exkl. moms</p>
        <p>Beställd {date(order.created_at)} av {order.requester_name} ({order.requester_email}).</p>
        <p className="mt-3 whitespace-pre-wrap">{order.message || 'Inget meddelande lämnades.'}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-[180px_minmax(0,1fr)]">
          <dt className="text-stone-600">Organisationsnummer</dt><dd>{brf.org_number || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Adress</dt><dd>{[brf.address, brf.postal_code, brf.city].filter(Boolean).join(' ') || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Fakturaadress</dt><dd className="whitespace-pre-wrap">{brf.invoice_address || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Faktura via e-post</dt><dd>{brf.invoice_email || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Fakturareferens</dt><dd>{brf.invoice_reference || 'Ej angivet'}</dd>
        </dl>
      </section>
      <section className={sectionClass}>
        <h2 className={headingClass}>Ansökan</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[180px_minmax(0,1fr)]">
          <dt className="text-stone-600">Sökande</dt><dd>{item.applicant.name}</dd>
          <dt className="text-stone-600">E-post</dt><dd>{item.applicant.email || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Telefon</dt><dd>{item.applicant.phone || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Lägenhetsnummer</dt><dd>{item.unit.unitNumberInternal || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Skatteverkets nummer</dt><dd>{item.unit.unitNumberSkatteverket || 'Ej angivet'}</dd>
          <dt className="text-stone-600">Inskickad</dt><dd>{date(item.submittedAt)}</dd>
          <dt className="text-stone-600">Renoveringstyper</dt><dd>{item.actionTypes.map(type => type.label).join(', ') || item.actionType.label}</dd>
        </dl>
        <p className="mt-5 whitespace-pre-wrap">{item.description || 'Ingen beskrivning.'}</p>
        {item.blockedAt ? <p className="mt-4 text-rose-800">Spärrat {date(item.blockedAt)}: {item.blockedReason}</p> : null}
        <dl className="mt-5 grid gap-3">{(answersResult.data ?? []).map(answer => <div key={answer.id}><dt className="font-semibold">{relationLabel(answer.renoapp_apply_questions)}</dt><dd>{relationLabel(answer.renoapp_apply_question_options)}</dd></div>)}</dl>
      </section>
      <section className={sectionClass}>
        <h2 className={headingClass}>Underlag och företag</h2>
        {item.underlag.length === 0 ? <p>Inga underlag registrerade.</p> : <ul className="divide-y divide-stone-200">{item.underlag.map(row => <li key={row.id} className="py-4 first:pt-0">
          <h3 className="font-semibold">{row.label}</h3>
          <p>{row.requirementDecision === 'requested' ? 'Begärt av styrelsen' : row.requirementDecision === 'not_requested' ? 'Begärs inte av styrelsen' : 'Inget val registrerat'} · {row.checked ? 'Uppgifter finns' : 'Saknas'}</p>
          {row.summary.map((text, index) => <p key={index}>{text}</p>)}
          {row.details ? <div className="mt-2">
            <p>{[row.details.companyName, row.details.orgNumber, row.details.contactName].filter(Boolean).join(' · ')}</p>
            <p>{[row.details.email, row.details.phone, row.details.certificationReference].filter(Boolean).join(' · ')}</p>
            <p>Behörighet kontrollerad: {row.details.hasVerifiedAuthorization ? 'Ja' : 'Nej'}. Ansvar bekräftat: {row.details.acceptsResponsibility ? 'Ja' : 'Nej'}.</p>
          </div> : null}
          {row.suggestionSources.map(source => <p key={source.id} className="mt-1 text-stone-600">{[source.actionTypeLabel, source.questionLabel, source.answerLabel].filter(Boolean).join(' · ')}</p>)}
        </li>)}</ul>}
      </section>
      <section className={sectionClass}>
        <h2 className={headingClass}>Alla bilagor</h2>
        {item.documents.length === 0 ? <p>Inga bilagor har laddats upp.</p> : <ul className="divide-y divide-stone-200">{item.documents.map(file => <li key={file.id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-start">
          <div className="min-w-0"><p className="font-semibold">{file.fileName || 'Dokument'}</p><p className="text-stone-600">{file.documentTypeLabel} · {date(file.uploadedAt)}</p>{file.note ? <p className="whitespace-pre-wrap">{file.note}</p> : null}</div>
          <a href={fileUrl(file.id)} className="inline-flex min-h-10 shrink-0 items-center gap-2 font-semibold text-sky-800 underline"><Download size={16} aria-hidden="true" />Hämta<span className="sr-only"> {file.fileName}</span></a>
        </li>)}</ul>}
      </section>
      <section className={sectionClass}>
        <h2 className={headingClass}>Föreningens renoveringsregler</h2>
        {acceptance.version ? <>
          <p>Version {acceptance.version.version} · Godkänd {date(acceptance.acceptedAt)} av {acceptance.acceptedName} ({acceptance.acceptedEmail}).</p>
          {acceptance.version.format === 'text' ? <p className="mt-4 whitespace-pre-wrap">{acceptance.version.body}</p> : <a href={fileUrl('rules')} className="mt-3 inline-flex items-center gap-2 font-semibold text-sky-800 underline"><Download size={16} aria-hidden="true" />{acceptance.version.fileName}</a>}
        </> : <p>{acceptance.checkedAt ? 'Inga publicerade regler vid inskickningen.' : 'Inget registrerat godkännande.'}</p>}
      </section>
      {item.reviewFlags.length > 0 ? <section className={sectionClass}><h2 className={headingClass}>Kontrollpunkter</h2><ul className="space-y-3">{item.reviewFlags.map(flag => <li key={flag.id}><p className="font-semibold">{flag.label}</p><p>{flag.description}</p><p>{flag.sourceLabel}</p></li>)}</ul></section> : null}
      {item.completion ? <section className={sectionClass}><h2 className={headingClass}>Senaste kompletteringsbegäran</h2><p className="whitespace-pre-wrap">{item.completion.message}</p><p className="mt-2 text-stone-600">Skickad {date(item.completion.created_at)} · Besvarad {date(item.completion.submitted_at)}</p></section> : null}
      <section className={sectionClass}><h2 className={headingClass}>Styrelsens beslut</h2>{item.decisions.length === 0 ? <p>Inga beslut registrerade.</p> : <ul className="space-y-4">{item.decisions.map(decision => <li key={decision.id}><p className="font-semibold">{statusLabels[decision.decision] ?? decision.decision} · {date(decision.decidedAt)}</p><p className="whitespace-pre-wrap">{decision.reason}</p><p className="whitespace-pre-wrap">{decision.conditions}</p></li>)}</ul>}</section>
      <section className={sectionClass}><h2 className={headingClass}>Ärendehistorik</h2>{item.messages.length === 0 ? <p>Inga meddelanden.</p> : <ul className="space-y-4">{item.messages.map(message => <li key={message.id}><p className="font-semibold">{message.authorName || message.authorRole} · {date(message.createdAt)}</p><p className="whitespace-pre-wrap">{message.message}</p></li>)}</ul>}</section>
    </main>
  )
}
