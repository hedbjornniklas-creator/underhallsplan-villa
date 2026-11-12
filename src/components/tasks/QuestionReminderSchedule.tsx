import { DEFAULT_TASK_REMINDER_POLICY } from '@/lib/tasks/domain'

export default function QuestionReminderSchedule() {
  const policy = DEFAULT_TASK_REMINDER_POLICY
  const before = [...policy.dueReminderWorkingDaysBefore].filter(day => day > 0).sort((a, b) => b - a).map(day => `${day} ${day === 1 ? 'arbetsdag' : 'arbetsdagar'} före`).join(' · ')
  return <div className="mt-3 text-xs leading-5 text-slate-500" aria-label="Standardpåminnelser">
    <p>Standardpåminnelser: {before}{policy.dueReminderWorkingDaysBefore.includes(0) ? ' · på svarsdagen' : ''}.</p>
    <details className="mt-1"><summary className="cursor-pointer">Fler påminnelseregler</summary>
      <p className="mt-1">Efter svarstiden kan påminnelser skickas tidigast var {Math.max(policy.overdueCadenceHours, policy.minimumExternalContactIntervalHours)}:e timme. Utskicken anpassas efter uppgiftens status och tillåtna utskickstider. Upprepade obesvarade påminnelser flaggas till uppdragsgivaren och pausas automatiskt.</p>
      <p className="mt-1">Första uppföljning är en valfri extra avstämning. Lämna datumet tomt för att enbart använda de vanliga deadlinepåminnelserna.</p>
    </details>
  </div>
}
