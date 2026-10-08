'use client'

import { FileCheck2 } from 'lucide-react'
import { propertyFields } from '@/lib/properties/identity'
import {
  contractFields,
  contractParticipantFields,
  contractParticipantsForEditing,
  contractFieldSummary,
  contractEntryText,
  editContractParticipants,
  editedContractEntry,
  emptyContractDetails,
  type CustomerContractDetails,
  type ContractFieldKey
} from '@/lib/action-cases/customerContract'

const field =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50'
export default function CustomerContractFields({
  value: inputValue,
  onChange,
  fieldKeys,
  showAdvice = true,
  inline = false
}: {
  value?: CustomerContractDetails
  onChange: (value: CustomerContractDetails) => void
  fieldKeys?: ContractFieldKey[]
  showAdvice?: boolean
  inline?: boolean
}) {
  const value = inputValue ?? emptyContractDetails()
  if (!inputValue && !inline)
    return (
      <section className="border-t border-slate-200 pt-6">
        <h2 className="text-lg">Avtalsuppgifter</h2>
        <button
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"
          onClick={() => onChange(emptyContractDetails())}
        >
          <FileCheck2 size={18} /> Komplettera avtalsuppgifter
        </button>
      </section>
    )
  const advice = value.advice
  const adviceComplete = Boolean(
    advice.work.trim() &&
      advice.reason.trim() &&
      advice.communicatedAt &&
      advice.customerResponse.trim()
  )
  const selectedFields = contractFields.filter((f) => (!fieldKeys || fieldKeys.includes(f.key)) &&
    (f.key !== 'customerWork' || value.otherAgreements === undefined))
  const groups = [...new Set(selectedFields.map((f) => f.group))]
  const Group = inline ? 'div' : 'details'
  const Summary = inline ? 'h3' : 'summary'
  return (
    <section className={inline ? 'space-y-4' : 'space-y-4 border-t border-slate-200 pt-6'}>
      {!inline && <h2 className="text-lg">Avtalsuppgifter</h2>}
      {showAdvice && <Group className="border-b border-slate-200 pb-4">
        <Summary className="py-2 font-semibold">
          Avrådan{' '}
          <span className="ml-2 text-sm font-normal text-slate-500">
            {advice.status === 'unreviewed'
              ? 'Ej kontrollerad'
              : advice.status === 'none'
                ? advice.work ||
                  advice.reason ||
                  advice.communicatedAt ||
                  advice.customerResponse
                  ? 'Kontrollera kvarvarande uppgifter'
                  : 'Ingen avrådan'
                : adviceComplete
                  ? 'Avrådan dokumenterad'
                  : 'Behöver kompletteras'}
          </span>
        </Summary>
        <label className="mt-3 block text-sm">
          Avrådan *
          <select
            className={field}
            value={advice.status}
            onChange={(e) =>
              onChange({
                ...value,
                advice: {
                  ...advice,
                  status: e.target.value as typeof advice.status
                }
              })
            }
          >
            <option value="unreviewed">Ej kontrollerad</option>
            <option value="none">Ingen avrådan har lämnats</option>
            <option value="given">Avrådan har lämnats</option>
          </select>
        </label>
        {(advice.status === 'given' ||
          advice.work ||
          advice.reason ||
          advice.communicatedAt ||
          advice.customerResponse) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(
              [
                ['work', 'Arbete som avrådan gäller *'],
                ['reason', 'Skäl och konsekvenser *'],
                ['customerResponse', 'Beställarens besked *']
              ] as const
            ).map(([key, title]) => (
              <label key={key} className="text-sm sm:col-span-2">
                {title}
                <textarea
                  className={field}
                  rows={3}
                  value={advice[key]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      advice: { ...advice, [key]: e.target.value }
                    })
                  }
                />
              </label>
            ))}
            <label className="text-sm">
              Datum för avrådan *
              <input
                type="date"
                className={field}
                value={advice.communicatedAt}
                onChange={(e) =>
                  onChange({
                    ...value,
                    advice: { ...advice, communicatedAt: e.target.value }
                  })
                }
              />
            </label>
          </div>
        )}
      </Group>}
      {groups.map((group) => {
        const fields = selectedFields.filter((f) => f.group === group)
        return (
          <Group key={group} className={inline ? '' : 'border-b border-slate-200 pb-4'}>
            {!inline && <Summary className="cursor-pointer py-2 font-semibold">
              {group}{' '}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {contractFieldSummary(value, fields.map(({ key }) => key))}
              </span>
            </Summary>}
            <div className="space-y-5 pt-3">
              {fields.map(({ key, title }) => {
                if (key === 'controls') {
                  const participants = contractParticipantsForEditing(value)
                  return <div key={key} className="space-y-5">
                    {contractParticipantFields.map(({ key: participantKey, title: participantTitle }) =>
                      <label key={participantKey} className="block text-sm font-medium">
                        {participantTitle} *
                        <textarea aria-label={participantTitle} className={field} rows={2} maxLength={2000} placeholder="Namn och kontaktuppgifter"
                          value={participants[participantKey]}
                          onChange={(e) => onChange(editContractParticipants(value, { [participantKey]: e.target.value }))} />
                      </label>)}
                  </div>
                }
                const entry = value.fields[key]
                const change = (text: string) =>
                  onChange({
                    ...value,
                    fields: { ...value.fields, [key]: editedContractEntry(text) }
                  })
                return (
                  <div key={key}>
                    <label className="block text-sm font-medium">
                      {title} *
                      <textarea
                        aria-label={title}
                        className={field}
                        rows={key === 'workEnvironment' ? 7 : 3}
                        maxLength={6000}
                        value={contractEntryText(entry)}
                        onChange={(e) => change(e.target.value)}
                      />
                    </label>
                  </div>
                )
              })}
            </div>
          </Group>
        )
      })}
    </section>
  )
}

export function CustomerContractDocument({
  value,
  omitParties = false
}: {
  value?: CustomerContractDetails
  omitParties?: boolean
}) {
  if (!value) return null
  const advice = value.advice
  return (
    <section className="border-t border-slate-200 py-6">
      <h3 className="text-lg font-semibold">Avtalsuppgifter</h3>
      <div className="mt-5">
        <h4 className="font-semibold">Avrådan</h4>
        <p className="mt-2 text-sm">
          {advice.status === 'none'
            ? 'Ingen avrådan har lämnats.'
            : advice.status === 'unreviewed'
              ? 'Ej kontrollerad'
              : `Avrådan lämnad ${advice.communicatedAt || '(datum saknas)'}`}
        </p>
        {advice.status === 'given' && (
          <dl className="mt-3 space-y-3 text-sm">
            {[
              ['Arbete', advice.work],
              ['Skäl och konsekvenser', advice.reason],
              ['Beställarens besked', advice.customerResponse]
            ].map(([title, text]) => (
              <div key={title}>
                <dt className="font-medium">{title}</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-6">
                  {text || 'Ej angivet'}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {contractFields.filter(({ key }) => (!omitParties || key !== 'parties') && (key !== 'documents' || !value.assignment) &&
        (key !== 'customerWork' || value.otherAgreements === undefined)).map(({ key, title }) => (
        <div key={key} className="mt-5 border-t border-slate-100 pt-4">
          <h4 className="font-semibold">{title}</h4>
          {key === 'property' && value.property ? <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {propertyFields.map(({ key: propertyKey, title: propertyTitle }) => value.property![propertyKey] ? <div key={propertyKey}>
              <dt className="font-medium">{propertyTitle}</dt>
              <dd className="mt-1 break-words text-slate-700">{value.property![propertyKey]}</dd>
            </div> : null)}
          </dl> : key === 'controls' && value.controlParticipants ? <dl className="mt-3 space-y-3 text-sm">
            {contractParticipantFields.map(({ key: participantKey, title: participantTitle }) => <div key={participantKey}>
              <dt className="font-medium">{participantTitle}</dt>
              <dd className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{value.controlParticipants![participantKey] || 'Ej angivet'}</dd>
            </div>)}
            {value.controlParticipants.previousDetails?.text && <div>
              <dt className="font-medium">Gemensamma uppgifter</dt>
              <dd className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{contractEntryText(value.controlParticipants.previousDetails)}</dd>
            </div>}
          </dl> :
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {value.fields[key].status === 'unreviewed'
              ? 'Ej kontrollerat'
              : contractEntryText(value.fields[key]) || 'Ej angivet'}
          </p>}
        </div>
      ))}
    </section>
  )
}
