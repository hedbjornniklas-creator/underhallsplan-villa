'use client'

import { Download, ExternalLink, FileText } from 'lucide-react'
import { rulesFileUrl, type RenovationRulesAcceptance, type RenovationRulesVersion } from '@/lib/renoapp/renovationRules'

export function RenovationRulesDocument({ rules, token }: { rules: RenovationRulesVersion; token?: string | null }) {
  return (
    <details className="min-w-0 border-y border-stone-200 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-900">
        Läs renoveringsreglerna <span className="font-normal text-stone-600">(version {rules.version})</span>
      </summary>
      {rules.format === 'text' ? (
        <div className="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-stone-800">{rules.body}</div>
      ) : (
        <div className="mt-4 grid min-w-0 gap-3 text-sm">
          <p className="flex min-w-0 items-start gap-2 text-stone-700"><FileText size={18} className="shrink-0" /><span className="break-all">{rules.fileName}</span></p>
          <div className="flex flex-wrap gap-4">
            <a className="inline-flex items-center gap-2 font-semibold text-sky-800 underline underline-offset-4" href={rulesFileUrl(rules.id, token)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Öppna PDF</a>
            <a className="inline-flex items-center gap-2 font-semibold text-sky-800 underline underline-offset-4" href={rulesFileUrl(rules.id, token, true)} target="_blank" rel="noopener noreferrer"><Download size={16} />Ladda ned</a>
          </div>
        </div>
      )}
    </details>
  )
}

export function RenovationRulesReceipt({ acceptance, token }: { acceptance: RenovationRulesAcceptance; token?: string | null }) {
  return (
    <div className="min-w-0 space-y-3 border-t border-stone-200 pt-4 text-sm">
      <h3 className="font-semibold text-stone-900">Föreningens renoveringsregler</h3>
      {acceptance.acceptedAt && acceptance.version ? <>
        <p className="break-words text-emerald-800">Godkända {new Date(acceptance.acceptedAt).toLocaleString('sv-SE')} av {acceptance.acceptedName} ({acceptance.acceptedEmail}).</p>
        <RenovationRulesDocument rules={acceptance.version} token={token} />
      </> : <p className="text-stone-600">{acceptance.checkedAt ? 'Föreningen hade inga publicerade renoveringsregler när ansökan skickades in.' : 'Inget godkännande av renoveringsregler finns registrerat för denna ansökan.'}</p>}
    </div>
  )
}
