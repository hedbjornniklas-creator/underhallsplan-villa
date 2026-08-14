'use client'

import { useState } from 'react'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

type PasswordAuthPanelProps = {
  redirectTo?: string
  accent?: 'blue' | 'emerald'
}

const localization = {
  variables: {
    sign_in: {
      email_label: 'E-post',
      password_label: 'Lösenord',
      email_input_placeholder: 'namn@foretag.se',
      password_input_placeholder: 'Ditt lösenord',
      button_label: 'Logga in',
      loading_button_label: 'Loggar in ...',
    },
    forgotten_password: {
      email_label: 'E-post',
      email_input_placeholder: 'namn@foretag.se',
      button_label: 'Skicka återställningslänk',
      loading_button_label: 'Skickar ...',
      confirmation_text: 'Kontrollera din e-post för länken som återställer lösenordet.',
    },
    update_password: {
      password_label: 'Nytt lösenord',
      password_input_placeholder: 'Välj ett nytt lösenord',
      button_label: 'Spara nytt lösenord',
      loading_button_label: 'Sparar ...',
      confirmation_text: 'Ditt lösenord har uppdaterats.',
    },
  },
} as const

export default function PasswordAuthPanel({ redirectTo, accent = 'blue' }: PasswordAuthPanelProps) {
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const isEmerald = accent === 'emerald'
  const brand = isEmerald ? '#047857' : '#1d4ed8'
  const brandAccent = isEmerald ? '#065f46' : '#1e40af'

  const appearance = {
    theme: ThemeSupa,
    variables: {
      default: {
        colors: {
          brand,
          brandAccent,
          brandButtonText: '#ffffff',
          inputBackground: '#ffffff',
          inputBorder: '#d6d3d1',
          inputBorderHover: isEmerald ? '#6ee7b7' : '#93c5fd',
          inputBorderFocus: brand,
          inputLabelText: '#292524',
          inputText: '#1c1917',
          inputPlaceholder: '#a8a29e',
          messageBackground: '#f0fdf4',
          messageBorder: '#bbf7d0',
          messageText: '#166534',
          messageBackgroundDanger: '#fff1f2',
          messageBorderDanger: '#fecdd3',
          messageTextDanger: '#be123c',
        },
        space: {
          labelBottomMargin: '8px',
          inputPadding: '13px 14px',
          buttonPadding: '13px 16px',
        },
        fontSizes: {
          baseInputSize: '15px',
          baseLabelSize: '14px',
          baseButtonSize: '15px',
        },
        fonts: {
          bodyFontFamily: 'Arial, Helvetica, sans-serif',
          buttonFontFamily: 'Arial, Helvetica, sans-serif',
          inputFontFamily: 'Arial, Helvetica, sans-serif',
          labelFontFamily: 'Arial, Helvetica, sans-serif',
        },
        radii: {
          borderRadiusButton: '14px',
          inputBorderRadius: '14px',
        },
      },
    },
    style: {
      button: { fontWeight: 700 },
      label: { fontWeight: 700 },
      message: { borderRadius: '14px', lineHeight: '1.5' },
    },
  } as const

  return (
    <div>
      {showPasswordReset ? (
        <div>
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                isEmerald ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
              }`}
            >
              <KeyRound size={18} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-stone-950">Återställ lösenord</h3>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Ange e-postadressen som är kopplad till ditt HusHub-konto.
              </p>
            </div>
          </div>

          <Auth.ForgottenPassword
            supabaseClient={supabase}
            appearance={appearance}
            i18n={localization.variables}
            redirectTo={redirectTo}
            showLinks={false}
          />

          <button
            type="button"
            onClick={() => setShowPasswordReset(false)}
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-stone-950"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Tillbaka till inloggningen
          </button>
        </div>
      ) : (
        <div>
          <Auth
            supabaseClient={supabase}
            appearance={appearance}
            providers={[]}
            redirectTo={redirectTo}
            view="sign_in"
            showLinks={false}
            localization={localization}
          />

          <button
            type="button"
            onClick={() => setShowPasswordReset(true)}
            className={`mt-4 text-sm font-semibold transition ${
              isEmerald ? 'text-emerald-800 hover:text-emerald-950' : 'text-blue-800 hover:text-blue-950'
            }`}
          >
            Glömt lösenordet?
          </button>
        </div>
      )}
    </div>
  )
}
