'use client'

import { FileCheck2 } from 'lucide-react'
import {
  contractFields,
  emptyContractDetails,
  type CustomerContractDetails,
  type ContractFieldKey,
  type ContractEntry
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
  const selectedFields = contractFields.filter((f) => !fieldKeys || fieldKeys.includes(f.key))
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
        const done = fields.filter(
          (f) =>
            value.fields[f.key].status !== 'unreviewed' &&
            value.fields[f.key].text.trim()
        ).length
        return (
          <Group key={group} className={inline ? '' : 'border-b border-slate-200 pb-4'}>
            {!inline && <Summary className="cursor-pointer py-2 font-semibold">
              {group}{' '}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {done}/{fields.length} ifyllda
              </span>
            </Summary>}
            <div className="space-y-5 pt-3">
              {fields.map(({ key, title }) => {
                const entry = value.fields[key]
                const change = (patch: Partial<ContractEntry>) =>
                  onChange({
                    ...value,
                    fields: { ...value.fields, [key]: { ...entry, ...patch } }
                  })
                return (
                  <div key={key}>
                    <label className="block text-sm font-medium">
                      {title} *
                      <select
                        className={field}
                        value={entry.status}
                        onChange={(e) =>
                          change({
                            status: e.target.value as ContractEntry['status']
                          })
                        }
                      >
                        <option value="unreviewed">Ej kontrollerat</option>
                        <option value="specified">Ange uppgifter</option>
                        <option value="document">
                          Regleras i avtalshandling
                        </option>
                        <option value="not_applicable">
                          Ej aktuellt, ange skäl
                        </option>
                      </select>
                    </label>
                    {(entry.status !== 'unreviewed' || entry.text) && (
                      <label className="mt-2 block text-sm">
                        {entry.status === 'document'
                          ? 'Handling, version och avsnitt *'
                          : entry.status === 'not_applicable'
                            ? 'Skäl *'
                            : 'Uppgifter *'}
                        <textarea
                          className={field}
                          rows={3}
                          value={entry.text}
                          onChange={(e) => change({ text: e.target.value })}
                        />
                      </label>
                    )}
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
  value
}: {
  value?: CustomerContractDetails
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
      {contractFields.map(({ key, title }) => (
        <div key={key} className="mt-5 border-t border-slate-100 pt-4">
          <h4 className="font-semibold">{title}</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {value.fields[key].status === 'unreviewed'
              ? 'Ej kontrollerat'
              : `${value.fields[key].status === 'not_applicable' ? 'Ej aktuellt: ' : value.fields[key].status === 'document' ? 'Avtalshandling: ' : ''}${value.fields[key].text || 'Ej angivet'}`}
          </p>
        </div>
      ))}
    </section>
  )
}
