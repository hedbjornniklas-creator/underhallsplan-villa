'use client'

import { INVESTIGATE_OPTION_KEY, type ClarificationAnswers, type ClarificationQuestion } from '@/lib/renoapp/clarifications'

export default function ApplicantClarifications({ questions, answers, onChange, disabled = false }: {
  questions: ClarificationQuestion[]
  answers: ClarificationAnswers
  onChange: (answers: ClarificationAnswers) => void
  disabled?: boolean
}) {
  if (!questions.length) return null
  return (
    <section aria-labelledby="clarification-heading" className="my-5 min-w-0 border-y border-[var(--reno-line)] py-5">
      <h3 id="clarification-heading" className="text-lg font-semibold">Frågor att klarlägga</h3>
      {questions.map(question => {
        const answer = answers[question.questionId] ?? { optionId: '', note: '' }
        const investigating = question.options.find(option => option.id === answer.optionId)?.key === INVESTIGATE_OPTION_KEY
        return (
          <fieldset key={question.questionId} disabled={disabled} className="mt-5 min-w-0 space-y-3">
            <legend className="mb-2 font-semibold">{question.label}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {question.options.map(option => (
                <label key={option.id} className="flex min-h-11 items-start gap-3 rounded-md border border-[var(--reno-line)] p-3 text-sm has-[:checked]:border-[var(--reno-ink)] has-[:checked]:bg-stone-50">
                  <input type="radio" className="mt-0.5 h-4 w-4 shrink-0" name={`clarification-${question.questionId}`}
                    checked={answer.optionId === option.id} onChange={() => onChange({ ...answers, [question.questionId]: { ...answer, optionId: option.id } })} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium">
              {investigating ? 'Vad återstår att undersöka, och varför? (obligatoriskt)' : 'Kommentar till svaret (valfritt)'}
              <textarea rows={3} maxLength={4000} value={answer.note}
                onChange={event => onChange({ ...answers, [question.questionId]: { ...answer, note: event.target.value } })}
                className="mt-2 block w-full rounded-md border border-[var(--reno-line)] bg-white p-3 font-normal" />
            </label>
            {investigating && <p className="text-sm text-[var(--reno-muted)]">Frågan förblir öppen för styrelsens bedömning.</p>}
          </fieldset>
        )
      })}
    </section>
  )
}
