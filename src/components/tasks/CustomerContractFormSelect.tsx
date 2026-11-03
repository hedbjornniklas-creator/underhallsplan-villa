'use client'

import { useState } from 'react'
import type { CustomerOfferDraft, CustomerOfferFile } from '@/lib/action-cases/customerOffers'
import { changeContractForm } from '@/lib/action-cases/standardContractTerms'

export default function CustomerContractFormSelect({ draft, files, onChange }: {
  draft: CustomerOfferDraft; files: CustomerOfferFile[]; onChange: (patch: Partial<CustomerOfferDraft>) => void
}) {
  const [error, setError] = useState('')
  return <label className="block text-sm font-medium">Avtalsgrund
    <select aria-label="Avtalsgrund" className="mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={draft.contractForm}
      onChange={event => {
        try { onChange(changeContractForm(draft, event.target.value as CustomerOfferDraft['contractForm'], files)); setError('') }
        catch { setError('Avtalsgrunden kunde inte bytas. Korta de projektspecifika villkoren först. Ingen text har tagits bort.') }
      }}>
      <option value="abs18">ABS 18 - entreprenadkontrakt</option>
      <option value="hf17">HF17 - Hantverkarformuläret 17</option>
      <option value="ab04">AB 04 - utförandeentreprenad</option>
      <option value="abt06">ABT 06 - totalentreprenad</option>
      <option value="custom">Egen avtalshandling</option>
    </select>
    {error && <span role="alert" className="mt-1 block text-sm text-red-700">{error}</span>}
    {(draft.contractForm === 'ab04' || draft.contractForm === 'abt06') && <a className="mt-2 block text-sm text-teal-800 underline" href="https://foreningenbkk.se/produkter/" target="_blank" rel="noreferrer">BKK:s kontraktsformulär och standardbestämmelser</a>}
  </label>
}
