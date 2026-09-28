'use client'

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Plus, Save, X } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import PendingLink from '@/components/ui/PendingLink'
import type { MoistureOptions, MoistureProject } from '@/lib/moisture/domain'
import { SCOPE_OPTIONS } from './MoistureWorkspace'

type NewProperty = { mode: 'new'; name: string; address: string; cadastralId: string; municipality: string; postalCode: string; city: string }
export type MoistureFormValues = {
  title: string
  description: string
  scopes: MoistureProject['scopes']
  pricingMode: MoistureProject['pricingMode']
  customerId: string | null
  property: { mode: 'existing'; id: string } | NewProperty
  buildingIds: string[]
  newBuildings: string[]
}

function initialValues(project: MoistureProject | undefined, options: MoistureOptions): MoistureFormValues {
  return {
    title: project?.title ?? '', description: project?.description ?? '', scopes: project?.scopes ?? [],
    pricingMode: project?.pricingMode ?? 'undecided', customerId: project?.customerId ?? null,
    property: project ? { mode: 'existing', id: project.propertyId } : options.properties.length
      ? { mode: 'existing', id: '' }
      : { mode: 'new', name: '', address: '', cadastralId: '', municipality: '', postalCode: '', city: '' },
    buildingIds: project?.buildings.map(building => building.id) ?? [], newBuildings: [],
  }
}

export default function MoistureProjectForm({ orgId, options, project, busy, frozen = false, error, fieldErrors = {}, onSubmit, submitLabel, busyLabel }: {
  orgId: string
  options: MoistureOptions
  project?: MoistureProject
  busy: boolean
  frozen?: boolean
  error?: string | null
  fieldErrors?: Record<string, string>
  onSubmit: (values: MoistureFormValues) => Promise<void>
  submitLabel: string
  busyLabel: string
}) {
  const id = useId()
  const [values, setValues] = useState(() => initialValues(project, options))
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const original = useMemo(() => initialValues(project, options), [project, options])
  const dirty = JSON.stringify(values) !== JSON.stringify(original)
  const locked = busy || frozen
  const errors = { ...fieldErrors, ...localErrors }
  const propertyId = values.property.mode === 'existing' ? values.property.id : null
  const selectedProperty = propertyId
    ? options.properties.find(property => property.id === propertyId)
    : null
  const buildings = selectedProperty?.buildings ?? project?.buildings ?? []
  const customerOptions = project?.customer && !options.customers.some(customer => customer.id === project.customer?.id)
    ? [project.customer, ...options.customers] : options.customers

  useEffect(() => {
    if (!dirty && !frozen) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const confirmLeaving = () => window.confirm(frozen
      ? 'Sparandet är inte bekräftat. Uppgifterna finns kvar här. Vill du ändå lämna sidan?'
      : 'Du har osparade ändringar. Vill du lämna sidan utan att spara dem?')
    const guardNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return
      const next = new URL(target.href, window.location.href)
      if (next.pathname === window.location.pathname && next.search === window.location.search) return
      if (!confirmLeaving()) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const guardOrganizationSwitch = (event: Event) => {
      if (!event.defaultPrevented && !confirmLeaving()) event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    window.addEventListener('hushub:before-organization-switch', guardOrganizationSwitch)
    document.addEventListener('click', guardNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', guard)
      window.removeEventListener('hushub:before-organization-switch', guardOrganizationSwitch)
      document.removeEventListener('click', guardNavigation, true)
    }
  }, [dirty, frozen])

  function update<K extends keyof MoistureFormValues>(key: K, value: MoistureFormValues[K]) {
    setValues(current => ({ ...current, [key]: value }))
    setLocalErrors(current => { const next = { ...current }; delete next[key]; return next })
  }
  function fieldError(key: string) {
    return errors[key] ? <p className="moisture-field-error" id={`${id}-${key}-error`}>{errors[key]}</p> : null
  }
  function errorProps(key: string) {
    return { 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `${id}-${key}-error` : undefined }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const next: Record<string, string> = {}
    if (!values.title.trim()) next.title = 'Ange ett projektnamn.'
    if (!values.scopes.length) next.scopes = 'Välj minst en del av uppdraget.'
    if (values.property.mode === 'existing' && !values.property.id) next.property = 'Välj en fastighet.'
    if (values.property.mode === 'new' && !values.property.name.trim()) next['property.name'] = 'Ange fastighetens namn.'
    setLocalErrors(next)
    if (Object.keys(next).length) return
    await onSubmit({ ...values, newBuildings: values.newBuildings.map(name => name.trim()).filter(Boolean) })
  }

  return <form className="moisture-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
    <fieldset disabled={locked}>
      <legend>Uppdraget</legend>
      <div className="moisture-fields">
        <label className="moisture-field moisture-wide" htmlFor={`${id}-title`}>Projektnamn <span className="moisture-required">Obligatoriskt</span>
          <input id={`${id}-title`} name="title" value={values.title} onChange={event => update('title', event.target.value)} maxLength={200} autoComplete="off" {...errorProps('title')} />
          {fieldError('title')}
        </label>
        <label className="moisture-field" htmlFor={`${id}-customer`}>Beställare
          <select id={`${id}-customer`} name="customerId" value={values.customerId ?? ''} onChange={event => update('customerId', event.target.value || null)} {...errorProps('customerId')}>
            <option value="">Ange senare</option>
            {customerOptions.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.customerNumber ? ` · ${customer.customerNumber}` : ''}</option>)}
          </select>
          {fieldError('customerId')}
        </label>
        <div className="moisture-field-help"><p>{customerOptions.length ? 'Beställare väljs från organisationens kundregister.' : 'Kundregistret är tomt. Du kan skapa projektet och ange beställare senare.'}</p>
          <PendingLink href={`/settings/kunder?orgId=${encodeURIComponent(orgId)}`} target="_blank" rel="noopener noreferrer" className="moisture-text-link">Öppna kundregistret i ny flik</PendingLink>
        </div>
        <label className="moisture-field moisture-wide" htmlFor={`${id}-description`}>Kort beskrivning
          <textarea id={`${id}-description`} name="description" value={values.description} onChange={event => update('description', event.target.value)} rows={3} maxLength={5000} placeholder="Beskriv uppdragets syfte och kända förutsättningar." {...errorProps('description')} />
          {fieldError('description')}
        </label>
      </div>
    </fieldset>

    <fieldset disabled={locked}>
      <legend>Fastighet</legend>
      {project ? <div className="moisture-property-summary">
        <strong>{project.property.name}</strong>
        <p>{[project.property.address, [project.property.postalCode, project.property.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adress saknas'}</p>
        <dl><div><dt>Fastighetsbeteckning</dt><dd>{project.property.cadastralId || 'Inte angiven'}</dd></div><div><dt>Kommun</dt><dd>{project.property.municipality || 'Inte angiven'}</dd></div></dl>
        <p className="moisture-muted">Projektet är kopplat till denna fastighet.</p>
        {(!project.property.cadastralId || !project.property.municipality) && <p className="moisture-fact-gap">Saknas: {[!project.property.cadastralId && 'fastighetsbeteckning', !project.property.municipality && 'kommun'].filter(Boolean).join(' och ')}.</p>}
        <PendingLink href={`/properties/${project.propertyId}`} target="_blank" rel="noopener noreferrer" className="moisture-text-link">Öppna fastighetsregistret i ny flik</PendingLink>
        <p className="moisture-muted">Uppgifter kompletteras i fastighetsregistret av den som har behörighet.</p>
      </div> : <>
        <div className="moisture-radio-row" role="group" aria-label="Välj fastighet eller skapa ny">
          <label><input type="radio" name={`${id}-propertyMode`} checked={values.property.mode === 'existing'} onChange={() => setValues(current => ({ ...current, property: { mode: 'existing', id: '' }, buildingIds: [] }))} />Välj befintlig</label>
          <label><input type="radio" name={`${id}-propertyMode`} checked={values.property.mode === 'new'} onChange={() => setValues(current => ({ ...current, property: { mode: 'new', name: '', address: '', cadastralId: '', municipality: '', postalCode: '', city: '' }, buildingIds: [] }))} />Skapa ny fastighet</label>
        </div>
        {values.property.mode === 'existing' ? <div className="moisture-fields">
          <label className="moisture-field moisture-wide" htmlFor={`${id}-property`}>Fastighet <span className="moisture-required">Obligatoriskt</span>
            <select id={`${id}-property`} value={values.property.id} onChange={event => { setValues(current => ({ ...current, property: { mode: 'existing', id: event.target.value }, buildingIds: [] })); setLocalErrors(current => { const next = { ...current }; delete next.property; return next }) }} {...errorProps(errors['property.id'] ? 'property.id' : 'property')}>
              <option value="">Välj fastighet</option>
              {options.properties.map(property => <option key={property.id} value={property.id}>{property.name}{property.cadastralId ? ` · ${property.cadastralId}` : ''}{property.address ? ` · ${property.address}` : ''}</option>)}
            </select>{fieldError('property')}{fieldError('property.id')}
          </label>
          {!options.properties.length && <p className="moisture-muted moisture-wide">Det finns inga fastigheter att välja. Välj Skapa ny fastighet ovan.</p>}
          {selectedProperty && <p className="moisture-muted moisture-wide">{[selectedProperty.cadastralId, selectedProperty.municipality, selectedProperty.address, selectedProperty.city].filter(Boolean).join(' · ') || 'Fastighetens adress och beteckning är inte angivna.'}</p>}
        </div> : <div className="moisture-fields">
          {([
            ['name', 'Fastighetens namn', 'off'], ['cadastralId', 'Fastighetsbeteckning', 'off'],
            ['address', 'Adress', 'street-address'], ['municipality', 'Kommun', 'off'],
            ['postalCode', 'Postnummer', 'postal-code'], ['city', 'Ort', 'address-level2'],
          ] as const).map(([key, label, autoComplete]) => <label className="moisture-field" key={key} htmlFor={`${id}-property-${key}`}>{label}{key === 'name' && <span className="moisture-required">Obligatoriskt</span>}
            <input id={`${id}-property-${key}`} name={`property.${key}`} value={values.property.mode === 'new' ? values.property[key] : ''} autoComplete={autoComplete} maxLength={key === 'postalCode' ? 20 : 200}
              onChange={event => { const value = event.target.value; setValues(current => current.property.mode === 'new' ? { ...current, property: { ...current.property, [key]: value } } : current); setLocalErrors(current => { const next = { ...current }; delete next[`property.${key}`]; return next }) }} {...errorProps(`property.${key}`)} />
            {fieldError(`property.${key}`)}
          </label>)}
          {fieldError('property')}
        </div>}
      </>}
    </fieldset>

    <fieldset disabled={locked}>
      <legend>Byggnader som ingår</legend>
      <p className="moisture-muted moisture-section-intro">Välj byggnader på fastigheten eller lägg till en ny. Det går att komplettera senare.</p>
      {buildings.length > 0 && <div className="moisture-building-checks">{buildings.map(building => <label className="moisture-check" key={building.id}>
        <input type="checkbox" checked={values.buildingIds.includes(building.id)} onChange={event => update('buildingIds', event.target.checked ? [...values.buildingIds, building.id] : values.buildingIds.filter(id => id !== building.id))} />{building.name}
      </label>)}</div>}
      {fieldError('buildingIds')}
      {values.newBuildings.map((name, index) => <div className="moisture-new-building" key={index}>
        <label className="moisture-field" htmlFor={`${id}-building-${index}`}>Ny byggnad {index + 1}
          <input id={`${id}-building-${index}`} value={name} onChange={event => update('newBuildings', values.newBuildings.map((current, itemIndex) => itemIndex === index ? event.target.value : current))} placeholder="Till exempel Huvudbyggnad" maxLength={200} {...errorProps(`newBuildings.${index}`)} />
          {fieldError(`newBuildings.${index}`)}
        </label>
        <button className="moisture-icon-button" type="button" onClick={() => update('newBuildings', values.newBuildings.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Ta bort ny byggnad ${index + 1}`}><X size={18} aria-hidden /></button>
      </div>)}
      {fieldError('newBuildings')}
      <button className="moisture-secondary" type="button" onClick={() => update('newBuildings', [...values.newBuildings, ''])} disabled={locked || values.newBuildings.length >= 20}><Plus size={16} aria-hidden />Lägg till byggnad</button>
    </fieldset>

    <fieldset disabled={locked} aria-describedby={errors.scopes ? `${id}-scopes-error` : undefined}>
      <legend>Uppdragets omfattning <span className="moisture-required">Välj minst en</span></legend>
      <div className="moisture-scope-options">{SCOPE_OPTIONS.map(option => <label className="moisture-scope-option" key={option.value}>
        <input type="checkbox" checked={values.scopes.includes(option.value)} onChange={event => update('scopes', event.target.checked ? [...values.scopes, option.value] : values.scopes.filter(scope => scope !== option.value))} {...errorProps('scopes')} />
        <span><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}</div>{fieldError('scopes')}
    </fieldset>

    <fieldset disabled={locked}>
      <legend>Prisgrund</legend>
      <label className="moisture-field moisture-price-field" htmlFor={`${id}-pricing`}>Hur ska uppdraget prissättas?
        <select id={`${id}-pricing`} value={values.pricingMode} onChange={event => update('pricingMode', event.target.value as MoistureProject['pricingMode'])} {...errorProps('pricingMode')}>
          <option value="undecided">Inte bestämt</option><option value="fixed">Fast pris</option><option value="hourly">Löpande</option>
        </select>{fieldError('pricingMode')}
      </label>
      <p className="moisture-muted moisture-section-intro">Belopp, timpris och villkor hanteras när offertfunktionen finns tillgänglig.</p>
    </fieldset>
    {error && <div className="moisture-error" role="alert"><strong>Kunde inte spara</strong><p>{error}</p></div>}
    {Object.keys(localErrors).length > 0 && <p className="moisture-field-error" role="alert">Kontrollera de markerade fälten. Dina uppgifter finns kvar.</p>}
    <div className="moisture-form-footer">
      <p className="moisture-muted">{frozen ? project ? 'Dina ändringar finns kvar för jämförelse med den sparade versionen.' : 'Uppgifterna behålls tills skapandet har bekräftats.' : project ? 'Ändringarna sparas när du väljer Spara grunddata.' : 'Du kan komplettera projektets grunddata senare.'}</p>
      <ActionButton type="submit" className="moisture-primary" busy={busy} busyLabel={busyLabel} disabled={Boolean(project && (!dirty || frozen))} icon={<Save size={17} aria-hidden />}>
        {submitLabel}
      </ActionButton>
    </div>
  </form>
}
