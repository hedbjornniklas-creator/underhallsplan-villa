// Local-only PDF QA. All parties, addresses and sender details are fictional.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { contractSenderFixture } from '../test/fixtures/contract-sender-profile.ts'
import { signingSnapshot, signingId } from '../test/fixtures/contract-signing.ts'
import { renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'

const directory = await mkdtemp(join(tmpdir(), 'contract-sender-pdf-'))
const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140"><rect width="480" height="140" rx="12" fill="#183d57"/><text x="32" y="91" fill="white" font-size="62" font-family="Arial">STYR TEST</text></svg>')).png().toBuffer()
for (const variant of ['normal', 'long']) {
  const snapshot = signingSnapshot(), sender = contractSenderFixture()
  sender.logoPath = `organizations/${sender.organizationId}/logo-00000000-0000-4000-8000-000000000092.png`
  sender.logoDataUrl = `data:image/png;base64,${logo.toString('base64')}`
  if (variant === 'long') {
    sender.name = 'Långt fiktivt avsändarnamn för layoutkontroll '.repeat(5).trim()
    sender.legalName = 'Fiktivt registrerat juridiskt företagsnamn '.repeat(5).trim()
    sender.reportFooterText = 'Fiktiv sidfot med längre information som måste få fortsätta över flera rader utan att krocka med sidnumreringen. '.repeat(17).trim()
  }
  snapshot.senderProfile = sender
  snapshot.issuerName = sender.name; snapshot.replyEmail = sender.email
  Object.assign(snapshot.contractParties.contractor, { companyName: sender.name, organizationNumber: sender.organizationNumber,
    street: sender.address, postalCode: sender.postalCode, city: sender.city, email: sender.email, phone: sender.phone })
  const bytes = await renderContractSigningPdf({ id: signingId(500), version: 1, createdAt: '2026-10-12T10:00:00Z', snapshot, files: [] })
  await writeFile(join(directory, `${variant}.pdf`), bytes)
}
console.log(directory)
