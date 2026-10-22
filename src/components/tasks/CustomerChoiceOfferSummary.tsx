import { choiceOfferSections } from '@/lib/action-cases/choiceOfferDocument'
import type { CustomerPlannedItem } from '@/lib/action-cases/customerPlanning'

export default function CustomerChoiceOfferSummary({ item }: { item: CustomerPlannedItem }) {
  if (!item.offer) return null
  return <div className="mt-4 space-y-4">{choiceOfferSections(item).map((section, index) => <section key={index} className="min-w-0 border-t border-[#D5DCDD] pt-3">
    <h4 className="font-semibold">{section.title}</h4>
    {section.rows && <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#EDF1F1]"><tr>{section.headers?.map((header, i) => <th scope="col" className="p-2" key={i}>{header}</th>)}</tr></thead><tbody>{section.rows.map((row, r) => <tr className="border-b border-[#D5DCDD]" key={r}>{row.map((cell, c) => <td className="break-words p-2 align-top" key={c}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {section.paragraphs?.map((text, i) => <p key={i} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{text}</p>)}
  </section>)}</div>
}
