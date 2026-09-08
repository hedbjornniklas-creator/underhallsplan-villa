type ProfileDetails = {
  full_name?: string | null
  sbr_group?: string | null
  sbr_status?: string | null
  membership_number?: string | null
  certification_number?: string | null
  phone?: string | null
  email?: string | null
  company_name?: string | null
  company_orgno?: string | null
  company_address?: string | null
  company_postal_code?: string | null
  company_city?: string | null
}

export default function InspectorProfileDetails({ profile, certificationLines = [] }: {
  profile: ProfileDetails | null
  certificationLines?: string[]
}) {
  const clean = (value: string | null | undefined) => value?.trim() || null
  const name = clean(profile?.full_name)
  const email = clean(profile?.email)
  const company = clean(profile?.company_name)
  const postalCity = [clean(profile?.company_postal_code), clean(profile?.company_city)].filter(Boolean).join(' ')
  const address = [clean(profile?.company_address), postalCity].filter(Boolean).join(', ')
  const suppliedCertifications = certificationLines.map(clean).filter((line): line is string => Boolean(line))
  const legacyCertifications = [
    clean(profile?.sbr_group), clean(profile?.sbr_status),
    clean(profile?.membership_number) ? `Medlem: ${clean(profile?.membership_number)}` : null,
    clean(profile?.certification_number) ? `Cert: ${clean(profile?.certification_number)}` : null,
  ].filter((line): line is string => Boolean(line))
  const lines = [
    ...(suppliedCertifications.length ? suppliedCertifications : legacyCertifications),
    clean(profile?.phone) ? `Tel: ${clean(profile?.phone)}` : null,
    email ? `E-post: ${email}` : null, company,
    clean(profile?.company_orgno) ? `Org.nr: ${clean(profile?.company_orgno)}` : null,
    address || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <div className="min-w-0 flex-1 text-[10px] leading-snug text-gray-700">
      <p className="truncate font-semibold text-gray-900">{name ?? 'Ditt visitkort'}</p>
      {lines.map((line, index) => <p key={`${index}-${line}`} className="truncate">{line}</p>)}
      {(!name || !email || !company) && <p className="mt-2 text-xs text-gray-600">Komplettera din profil med namn, e-post och företag. Här visas bara dina egna uppgifter.</p>}
    </div>
  )
}
