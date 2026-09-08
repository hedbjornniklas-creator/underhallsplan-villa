const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const active = { isActive: true, sortOrder: 100 }
const action = { ...active, id: id(100), key: 'kitchen', label: 'Kök', riskLevel: 'medium', contractorRequirement: 'none' }
const labels = ['Konstruktör', 'Ventilationsprojektering', 'Elprojektering', 'VVS-projektering', 'Bygganmälan', 'Beskrivning av planerat gasarbete']
const docs = labels.map((label, index) => ({ ...active, id: id(200 + index), key: `doc-${index}`, label, defaultPhase: 'before_required' }))
const roles = ['VVS-företag auktoriserat av Säker Vatten', 'Anlitad entreprenör', 'Auktoriserat gasinstallationsföretag']
  .map((label, index) => ({ ...active, id: id(300 + index), key: `role-${index}`, label, roleKind: 'contractor' }))
let next = 500
const trigger = (type, target) => ({ ...active, id: id(next++), triggerType: type,
  questionId: type === 'question' ? id(target) : null, documentTypeId: type === 'document' ? id(target) : null,
  participantRoleId: type === 'participant_role' ? id(target) : null, reviewFlagId: null })
const option = (number, label, triggers) => ({ ...active, id: id(number), key: `option-${number}`, label, sortOrder: number, triggers })
const question = (number, label, options) => ({ ...active, id: id(number), key: `question-${number}`, label, responseType: 'single_select', options })
export const compactWallQuestion = 'Behöver någon vägg rivas för att genomföra ändringen?'
const items = [
  question(101, 'Vad gäller ditt köksprojekt?', [
    option(110, 'Mindre renovering av befintligt kök', [trigger('question', 120), trigger('question', 130)]),
    option(111, 'Byte av befintligt kök', [trigger('participant_role', 300), trigger('participant_role', 301)]),
    option(112, 'Flytt av kök i bostad', [trigger('question', 140), trigger('question', 150), ...[201, 202, 203, 204].map(n => trigger('document', n))]),
  ]),
  ...[120, 130].map(n => question(n, 'Berör renoveringen en gasspis, gashäll, gasugn eller gasledning?', [
    option(n + 1, 'Ja', [trigger('document', 205), trigger('participant_role', 302)]), option(n + 2, 'Nej', []),
  ])),
  ...[140, 150].map(n => question(n, n === 140 ? compactWallQuestion : 'Berörs någon annan vägg?', [
    option(n + 1, 'Ja', [trigger('document', 200)]), option(n + 2, 'Nej', []),
  ])),
]
export const compactFlowResponses = {
  'action-types': { items: [action] }, 'questions': { items }, 'document-types': { items: docs }, 'participants': { items: roles },
  'review-flags': { items: [] }, 'review-flag-links': { items: [] }, 'action-type-participants': { actionTypes: [] },
  'action-type-questions': { actionTypes: [{ actionType: action, questions: [{ id: id(400), questionId: id(101), questionLabel: items[0].label, isRequired: true, sortOrder: 100 }] }] },
  'requirements': { actionTypes: [] },
}
export const compactWallAnswerIds = [id(141), id(142)]
