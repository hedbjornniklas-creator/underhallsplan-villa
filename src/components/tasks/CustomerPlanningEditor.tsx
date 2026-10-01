'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Loader2, Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import {
  planningStatuses,
  type CustomerPlannedItem,
  type CustomerPlanning
} from '@/lib/action-cases/customerPlanning'
import { money } from '@/lib/action-cases/customerOffers'
import PriceInput from './CustomerOfferPriceInput'
import CustomerOfferCostCalculator from './CustomerOfferCostCalculator'
import type { CustomerOfferCosting } from '@/lib/action-cases/customerOfferCosting'
import ProjectEditorRow from './ProjectEditorRow'
import { retainNewerDraft } from '@/lib/action-cases/draftSave'

const field =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
export default function CustomerPlanningEditor({
  caseId,
  initial,
  onDirty,
  onSaved
}: {
  caseId: string
  initial: CustomerPlanning
  onDirty: (dirty: boolean) => void
  onSaved: (value: CustomerPlanning) => void
}) {
  const [saved, setSaved] = useState(initial),
    [items, setItems] = useState(initial.items)
  const [costing, setCosting] = useState<CustomerOfferCosting>(initial.costing ?? {})
  const [busy, setBusy] = useState(''),
    [confirmed, setConfirmed] = useState(false)
  const [removed, setRemoved] = useState<CustomerPlannedItem | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const running = useRef(false),
    toast = useToast()
  const dirty = JSON.stringify(items) !== JSON.stringify(saved.items) ||
    JSON.stringify(costing) !== JSON.stringify(saved.costing ?? {})
  const shared =
    JSON.stringify(saved.items) === JSON.stringify(saved.sharedItems)
  useEffect(() => {
    onDirty(dirty || Boolean(busy))
  }, [dirty, busy, onDirty])
  function change(next: CustomerPlannedItem[]) {
    setItems(next)
    setConfirmed(false)
  }
  async function action(operation: 'save' | 'share' | 'unshare') {
    if (running.current) return
    running.current = true
    setBusy(operation)
    try {
      const response = await fetch(
        `/api/action-cases/${caseId}/customer-planning`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation,
            revision: saved.revision,
            items,
            ...(saved.costingAvailable && operation === 'save' ? { costing } : {}),
            confirmed
          })
        }
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Tillvalen kunde inte sparas.')
      setSaved(result)
      setItems((current) => retainNewerDraft(current, items, result.items))
      setCosting((current) => retainNewerDraft(current, costing, result.costing ?? {}))
      setConfirmed(false)
      onSaved(result)
      toast.success(
        operation === 'save'
          ? 'Val och tillval sparades.'
          : operation === 'share'
            ? 'Planerade tillval visas nu för beställaren. Inget är beställt.'
            : 'Planerade tillval är nu interna.'
      )
    } catch (error) {
      toast.error(error, 'Tillvalen kunde inte hanteras.')
    } finally {
      running.current = false
      setBusy('')
    }
  }
  return (
    <section className="py-6" aria-label="Val och tillval">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl">Val och tillval</h2>
          <p className="mt-2 text-sm text-slate-600">
            Inte beställda · Ingår inte i avtalssumman
          </p>
        </div>
        <p role="status" className="text-sm text-slate-500">
          {busy ? 'Sparar…' : dirty ? 'Osparade ändringar' : 'Sparat'}
        </p>
      </div>
      {!saved.available ? (
        <p className="py-6 text-sm text-amber-800">
          Planerade tillval behöver aktiveras av administratören.
        </p>
      ) : (
        <>
          <fieldset
            disabled={Boolean(busy) && busy !== 'save'}
            className="min-w-0 divide-y divide-slate-200"
          >
            {items.map((item) => {
              const patch = (value: Partial<CustomerPlannedItem>) =>
                change(
                  items.map((i) => (i.id === item.id ? { ...i, ...value } : i))
                )
              return (
                <ProjectEditorRow key={item.id} title={item.title || 'Nytt val eller tillval'}
                  summary={[item.optionGroup, planningStatuses[item.status], item.decisionBy && `Beslut ${item.decisionBy}`, !item.scope.trim() && 'Omfattning saknas'].filter(Boolean).join(' · ')}
                  amount={item.budgetOre === null ? 'Pris ej fastställt' : money(item.budgetOre)}
                  open={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? null : item.id)}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3 sm:col-span-2">
                    <label className="min-w-0 flex-1 text-sm">
                      Val eller tillval *
                      <input
                        className={field}
                        value={item.title}
                        maxLength={250}
                        onChange={(e) => patch({ title: e.target.value })}
                      />
                    </label>
                    <button
                      className="mt-5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 text-rose-700"
                      aria-label={`Ta bort planerat tillval ${item.title}`}
                      title="Ta bort tillval"
                      onClick={() => {
                        setRemoved(item)
                        change(items.filter((i) => i.id !== item.id))
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  <label className="text-sm">
                    Status
                    <select
                      className={field}
                      value={item.status}
                      onChange={(e) =>
                        patch({
                          status: e.target
                            .value as CustomerPlannedItem['status']
                        })
                      }
                    >
                      {Object.entries(planningStatuses).map(([key, title]) => (
                        <option key={key} value={key}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Önskat beslutsdatum
                    <input
                      className={field}
                      type="date"
                      value={item.decisionBy}
                      onChange={(e) => patch({ decisionBy: e.target.value })}
                    />
                  </label>
                  <label className="text-sm sm:col-span-2">
                    Omfattning *
                    <textarea
                      className={field}
                      rows={3}
                      value={item.scope}
                      maxLength={12000}
                      onChange={(e) => patch({ scope: e.target.value })}
                    />
                  </label>
                  <PriceInput
                    label="Prisunderlag inkl. moms (kr, valfritt)"
                    value={item.budgetOre}
                    onChange={(budgetOre) => patch({ budgetOre })}
                  />
                  <label className="text-sm">
                    Alternativgrupp (valfri)
                    <input className={field} maxLength={100} list="planned-choice-groups"
                      value={item.optionGroup ?? ''}
                      onChange={(e) => patch({ optionGroup: e.target.value })} />
                  </label>
                  {saved.costingAvailable && <div className="sm:col-span-2">
                    <CustomerOfferCostCalculator value={costing[item.id]} customerPrice={item.budgetOre}
                      onChange={(calculation) => setCosting((current) => ({ ...current, [item.id]: calculation }))}
                      onApply={(budgetOre) => patch({ budgetOre })} />
                  </div>}
                </div>
                </ProjectEditorRow>
              )
            })}
          </fieldset>
          <datalist id="planned-choice-groups">
            {[...new Set(items.map((i) => i.optionGroup).filter(Boolean))].map((group) => <option key={group} value={group} />)}
          </datalist>
          {!items.length && (
            <p className="py-6 text-sm text-slate-500">
              Inga val eller tillval har lagts till.
            </p>
          )}
          <div className="flex flex-wrap gap-3 py-4">
            <button
              className={button}
              disabled={Boolean(busy) && busy !== 'save'}
              onClick={() => {
                const id = crypto.randomUUID()
                setExpanded(id)
                change([
                  ...items,
                  {
                    id,
                    title: '',
                    scope: '',
                    status: 'planned',
                    budgetOre: null,
                    decisionBy: ''
                  }
                ])
              }}
            >
              <Plus size={17} /> Lägg till val eller tillval
            </button>
            {removed && (
              <button
                className={button}
                disabled={Boolean(busy)}
                onClick={() => {
                  change([...items, removed])
                  setRemoved(null)
                }}
              >
                <Undo2 size={17} /> Ångra borttagning
              </button>
            )}
            <button
              className={`${button} bg-slate-950 text-white`}
              disabled={Boolean(busy) || !dirty}
              onClick={() => void action('save')}
            >
              {busy === 'save' ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Save size={17} />
              )}{' '}
              Spara planering
            </button>
          </div>
          <section className="mt-4 border-t border-slate-200 py-5">
            <h3 className="font-semibold">Kundens vy</h3>
            <p className="mt-2 text-sm text-slate-600">
              {saved.sharedItems.length
                ? `${saved.sharedItems.length} ${saved.sharedItems.length === 1 ? 'planerat tillval är synligt' : 'planerade tillval är synliga'} för beställaren.`
                : 'Planeringen är intern.'}{' '}
              {!shared && saved.sharedItems.length
                ? 'Den sparade planeringen skiljer sig från kundens vy.'
                : ''}
            </p>
            {!shared && items.length > 0 && (
              <label className="mt-4 flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  checked={confirmed}
                  disabled={Boolean(busy) || dirty}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Jag har granskat innehållet som ska visas för beställaren som
                planering, inte beställning.
              </label>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              {!shared && items.length > 0 && (
                <button
                  className={button}
                  disabled={
                    Boolean(busy) ||
                    dirty ||
                    !confirmed ||
                    items.some((i) => !i.title.trim() || !i.scope.trim())
                  }
                  onClick={() => void action('share')}
                >
                  {busy === 'share' ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Eye size={17} />
                  )}{' '}
                  Visa för beställaren
                </button>
              )}
              {saved.sharedItems.length > 0 && (
                <button
                  className={button}
                  disabled={Boolean(busy) || dirty}
                  onClick={() => void action('unshare')}
                >
                  {busy === 'unshare' ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <EyeOff size={17} />
                  )}{' '}
                  Dölj planerade tillval
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  )
}

export function CustomerPlannedItems({
  items
}: {
  items: CustomerPlannedItem[]
}) {
  return (
    <section aria-label="Val och tillval" className="py-6">
      <h2 className="text-xl">Val och tillval</h2>
      <p className="mt-2 text-sm text-slate-600">
        Inte beställda · Ingår inte i avtalssumman
      </p>
      {items.map((item) => (
        <article key={item.id} className="border-b border-slate-200 py-5">
          {item.optionGroup && <p className="mb-2 text-sm font-medium text-violet-700">{item.optionGroup} · Alternativ</p>}
          <div className="flex flex-wrap justify-between gap-3">
            <h3 className="font-semibold">{item.title}</h3>
            <span className="text-sm text-slate-500">
              {planningStatuses[item.status]}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {item.scope}
          </p>
          <p className="mt-3 text-sm">
            {item.budgetOre === null
              ? 'Pris ej fastställt'
              : `Prisunderlag: ${money(item.budgetOre)} inklusive moms · Inte beställt`}
          </p>
          {item.decisionBy && (
            <p className="mt-2 text-sm text-slate-500">
              Önskat beslut senast {item.decisionBy}
            </p>
          )}
        </article>
      ))}
      {!items.length && (
        <p className="mt-5 text-sm text-slate-500">
          Inga val eller tillval har delats ännu.
        </p>
      )}
    </section>
  )
}
