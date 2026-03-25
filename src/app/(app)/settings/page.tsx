import { redirect } from 'next/navigation'

export default function LegacySettingsRedirectPage() {
  redirect('/ob/settings')
}

