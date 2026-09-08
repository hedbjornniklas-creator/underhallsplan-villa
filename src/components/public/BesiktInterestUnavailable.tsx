import { PUBLIC_BESIKTAPP_CONTACT_EMAIL } from '@/lib/publicCompanyInfo'

export default function BesiktInterestUnavailable() {
  // Only an explicitly published address may be exposed here, never delivery settings.
  const email = PUBLIC_BESIKTAPP_CONTACT_EMAIL
  return (
    <div className="public-notice" role="status">
      <p>Intresseformuläret är tillfälligt stängt.</p>
      <p>Mejla oss i stället. Skriv ditt namn och vad du vill ha hjälp med. Ange gärna företagets namn.</p>
      <a href={`mailto:${email}?subject=Intresse%20f%C3%B6r%20BesiktApp`} className="public-text-link">{email}</a>
    </div>
  )
}
