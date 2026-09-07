import { PUBLIC_COMPANY_INFO } from '@/lib/publicCompanyInfo'

export default function PublicCompanyIdentity() {
  return (
    <div className="public-company-identity">
      <p>HusHub ägs och drivs av {PUBLIC_COMPANY_INFO.name}.</p>
      <p>Org.nr {PUBLIC_COMPANY_INFO.organizationNumber}</p>
    </div>
  )
}
