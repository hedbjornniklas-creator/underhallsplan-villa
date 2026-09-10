'use client'

import { useState } from 'react'
import {
  isCommonTuMeasurementInstrument,
  TU_COMMON_MEASUREMENT_INSTRUMENTS,
} from '@/lib/tu/measurementInstruments'

const CUSTOM_INSTRUMENT_VALUE = '__custom_instrument__'

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  compact?: boolean
}

export default function TuMeasurementInstrumentSelect({
  value,
  onChange,
  disabled = false,
  compact = false,
}: Props) {
  const [customMode, setCustomMode] = useState(
    Boolean(value) && !isCommonTuMeasurementInstrument(value)
  )
  const commonValue = isCommonTuMeasurementInstrument(value) ? value : ''
  const customSelected = customMode || (Boolean(value) && !commonValue)
  const selectValue = customSelected ? CUSTOM_INSTRUMENT_VALUE : commonValue
  const heightClass = compact ? 'h-9 text-sm' : 'h-12 text-base'

  return (
    <div className="space-y-2">
      <select
        value={selectValue}
        aria-label="Instrument"
        onChange={(event) => {
          const nextValue = event.target.value
          if (nextValue === CUSTOM_INSTRUMENT_VALUE) {
            setCustomMode(true)
            onChange('')
            return
          }
          setCustomMode(false)
          onChange(nextValue)
        }}
        disabled={disabled}
        className={`${heightClass} w-full rounded-md border border-gray-300 bg-white px-3 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500`}
      >
        <option value="">Välj instrument</option>
        {TU_COMMON_MEASUREMENT_INSTRUMENTS.map((instrument) => (
          <option key={instrument} value={instrument}>{instrument}</option>
        ))}
        <option value={CUSTOM_INSTRUMENT_VALUE}>Annat instrument...</option>
      </select>

      {customSelected ? (
        <input
          value={value}
          aria-label="Annat instrument"
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoFocus
          placeholder="Märke och modell"
          className={`${heightClass} w-full rounded-md border border-gray-300 px-3 outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500`}
        />
      ) : null}
    </div>
  )
}
