import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('all inspection steps use one header and no floating duplicate navigation', () => {
  const page = read('src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx')
  assert.match(page, /ObInspectionNavigationContext.Provider/)
  assert.match(page, /className="ob-form-shell ob-inspection-shell"/)
  assert.doesNotMatch(page, /linear-gradient|ob-step-menu-toggle|md:shadow-xl|brandedForm/)
  const round = read('src/components/ob/ObMobileRound.tsx')
  assert.match(round, /<ObInspectionHeader/)
  assert.match(round, /portalContainer=\{placeSwipe.ref\} onDraftOpenChange=\{setDraftReviewOpen\}/)
  assert.doesNotMatch(round, /<ObLocalDraftStatus|className="obm-inspection-header"/)
  assert.match(read('src/components/ob/ObStepRunda.tsx'), /mobileLayout && <ObInspectionHeader/)
})

test('inspection styles do not reach other modules or embedded reports', () => {
  const css = postcss.parse(read('src/components/ob/inspection-layout.css'))
  css.walkRules(rule => rule.selectors.forEach(selector => assert.match(selector, /^(?:\.ob-|body\.ob-inspection-active)/)))
  assert.doesNotMatch(css.toString(), /iframe|--obm-[\w-]+\s*:/)
  const delivery = read('src/components/ob/ObWizard.tsx').split("case 'delivery':")[1].split("case 'grunddata':")[0]
  assert.match(delivery, /ob-delivery-workspace/)
  assert.match(delivery, /src=\{reportDeliveryPreviewHref\}/)
  assert.match(delivery, /disabled=\{deliverySendDisabled\}/)
  assert.match(delivery, /disabled=\{deliveryActionDisabled\}/)
  assert.doesNotMatch(delivery, /bg-indigo|shadow-sm|rounded-xl/)
})
