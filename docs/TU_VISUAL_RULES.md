# Visuella regler for TU-modulen

Date: 2026-05-27
Scope: Teknisk utredning, uppdragsbekraftelse, publik godkannandesida, utredningseditor, rapportgranskning, utskick och TU-specifika adminytor.

TU ska vara en egen modul med egen visuell identitet. Modultemat ar lila. Delade komponenter far ateranvandas, men TU ska inte se ut som en underflik till OB eller EB.

## Grundprinciper

- Primar temafarg for TU ar lila/violet.
- Lila anvands for navigation, primara atgarder, aktivt lage och modulmarkering.
- Statusfarger ska fortfarande vara semantiska och ska inte tvingas bli lila.
- Svart eller nara svart ska inte anvandas for vanliga knappar, aktiva filter eller primara atgarder.
- Layouten ska vara arbetsorienterad, lugn och tydlig. Undvik hero-kansla, stora dekorativa ytor och marknadsforingslayout i arbetsflodet.
- Inga dekorativa gradient-orbs, bokeh-effekter eller onodiga illustrationer.
- Text ska aldrig ligga utanfor knappar, chips, tabeller eller kort. Kompakta ytor ska ha kompakt typografi.
- Alla knappar som kan representeras med en tydlig ikon ska anvanda lucide-ikon med tooltip/title.

## Fargtokens

Primar TU-farg:

- Primary: `violet-600`
- Primary hover: `violet-700`
- Primary soft: `violet-50`
- Primary soft border: `violet-200`
- Primary text: `violet-900`
- Active neutral/tab: `border-violet-600 bg-violet-600 text-white`
- Focus ring: `focus-visible:ring-violet-500`

Neutrala ytor:

- Page background: `bg-slate-50` eller mycket ljus violet/slate-blandning
- Panel/card: `bg-white border-slate-200`
- Secondary surface: `bg-slate-50 border-slate-200`
- Text primary: `text-slate-950`
- Text secondary: `text-slate-600`
- Muted text: `text-slate-500`

Semantiska farger:

- Success/godkand/klar: emerald
- Warning/kraver uppmarksamhet: amber
- Danger/radera/avbryt: rose
- Info/lank/bild: sky
- Disabled: explicit ljus variant, inte bara opacity

## Typografi

Arbetsytor:

- Page title: `text-2xl font-semibold text-slate-950`
- Section title: `text-lg font-semibold text-slate-950`
- Panel/card title: `text-sm font-semibold text-slate-900`
- Body text: `text-sm leading-6 text-slate-700`
- Help/microcopy: `text-xs leading-5 text-slate-500`
- Table header: `text-xs font-semibold uppercase tracking-wide text-slate-600`
- Table cell: `text-sm text-slate-900`

Kompakta controls:

- Toolbar button text: `text-sm font-semibold`
- Small icon button: 32-36 px square
- Dense chip/filter: `text-xs font-semibold`
- Metadata labels: `text-[11px] font-medium uppercase tracking-wide`

Rapport/utlatande:

- Rapportens printvy far ha egen A4-typografi.
- Rapporttitel ska vara tydlig men inte app-hero-stor.
- Rapportsektioner ska folja dokumentets hierarki: titel, underrubrik, brodtext, bildtext.

Undvik:

- Viewport-baserad fontstorlek.
- Negativ letter-spacing.
- Hero-skala inne i paneler, tabeller och formularkort.

## Knappar

Alla knappar ska ha tydlig funktionell variant.

| Funktion | TU-regel |
| --- | --- |
| Primar atgard: skapa, spara, skicka, starta | `bg-violet-600 text-white hover:bg-violet-700` |
| Sekundar atgard: tillbaka, stang, avbryt utan risk | `bg-white border-slate-300 text-slate-700 hover:bg-slate-50` |
| Aktivt filter/flik/val | `border-violet-600 bg-violet-600 text-white` |
| Neutral knapp i toolbar | `bg-white border-slate-300 text-slate-700 hover:bg-slate-50` |
| Destruktiv atgard | `bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100` eller `bg-rose-600 text-white` for skarp bekrattelse |
| Varning/aterutskick/ny version | `bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100` |
| Klar/godkann/lasa | `bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100` eller `bg-emerald-600 text-white` for primar slutfor-atgard |
| Bild/uppladdning | `bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100` |
| AI/smart hjalp | `bg-fuchsia-600 text-white hover:bg-fuchsia-700` |

Disabled:

- Primar disabled: `disabled:bg-violet-50 disabled:text-violet-700 disabled:ring-1 disabled:ring-violet-200`
- Sekundar disabled: `disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200`
- Knappar ska ha `disabled:cursor-not-allowed`.

Ikonknappar:

- Anvand lucide-ikoner dar de finns.
- Standardstorlek: 16 px i 32-36 px knapp.
- Kritiska ikoner ska ha `aria-label` och `title`.
- Textknapp anvands nar handlingen annars blir otydlig, t.ex. "Skicka uppdragsbekraftelse".

## Formular

Inputs:

- Standard: `rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900`
- Focus: `focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500`
- Label: `text-xs font-medium text-slate-600`
- Help text: `text-[11px] text-slate-500`
- Error text: `text-xs text-rose-700`

Textareas:

- Ska autosparas med tydlig sparstatus dar det ar relevant.
- Minsta hojd for rapportsektioner: ca 220-320 px.
- Noteringsfalt kan vara 80-140 px.
- Lokala osparade drafts ska markeras eller skyddas pa samma satt som OB.

Select/chips:

- Select ska folja input-stil.
- Chips ska inte vara hogre an 32 px i listor/toolbar.
- Aktiva chips i TU anvander violet om de inte representerar status.

## Layout

Sidlayout:

- Arbetsytor anvander maxbredd `max-w-7xl` om det finns editor + sidomeny.
- Smalare formular kan anvanda `max-w-6xl`.
- Mobil ska ha en enkel toppkontroll och flytande/slide-in meny vid behov.
- Undvik kort-i-kort. Anvand kort for separata upprepade objekt, modaler och redigeringspaneler.

Editorlayout:

- Vanster sida: steg/sektioner eller lista.
- Hoger/hovedyta: aktiv redigering.
- Rapportsektioner ska ga snabbt att hoppa mellan.
- Lang text ska ha tydlig autosparstatus och inte krava manuell "Spara" for varje stycke.

Tabeller:

- Header: ljus neutral bakgrund.
- Rader ska kunna skannas pa datum, kund, adress, status och atgard.
- Radstatus kan fargsattas semantiskt som i OB, men TU-aktivt/valt lage ska vara violet.

Modaler/paneler:

- Bakgrundsoverlay far vara svart med transparens.
- Panelen ska vara vit med neutral border.
- Primarknapp i modal foljer samma funktionsregel som ovan.

## Statusvisning

TU-statusar:

- Utkast: slate
- Skickad: sky/blue
- Godkand: emerald eller amber beroende pa kontext
- Startad/pagaende: violet
- Utlatede klart/lost: emerald
- Makulerad/avbruten: rose
- Arkiverad: slate

Statusmarkeringar ska vara badges/chips, inte primara knappar om de inte ar klickbara.

## Bilder och bilagor

- Bildatgarder anvander sky som funktionell farg.
- Bildkort ska ha stabil aspect ratio, helst `aspect-square` for thumbnails och `object-cover`.
- Rapportbilder ska anvanda `object-contain` och tydlig bildtext.
- Uppladdning ska visa status: laddar, misslyckad, klar.

## Rapportvisuell regel

TU-rapporten ska kannas som ett tekniskt utlåtande:

- Vit A4-yta.
- Tydlig rubrikhierarki.
- Saklig typografi.
- Lila far anvandas sparsamt i omslag, sidhuvud, accentlinjer och aktiva UI-kontroller.
- Rapporttexten ska inte domineras av lila.
- Bildtexter ska vara mindre och tydligt kopplade till bilden.

## Access och modulidentitet

- TU ska alltid ha egen modulmarkering i dashboard och toppmeny.
- Anvandaren ska kunna ha TU utan OB och OB utan TU.
- TU-routes ska inte anvanda OB-ikonik, OB-texter eller OB-statusord om de inte ar generiska.
- Delade settings, profiler, dokumenttyper och certifieringar far ateranvandas nar det spar tid och inte skapar OB-beroende.

## Implementation checklist

- Ingen ny TU-knapp med `bg-black`, `bg-gray-900` eller svart aktivt lage.
- Primara TU-atgarder ar violet.
- Semantiska statusar behaller egna farger.
- Alla nya formular har konsekventa labels, focus-ringar och felmeddelanden.
- Alla ikonknappar har `aria-label` och `title`.
- Text ryms i knappar/chips pa mobil.
- Ingen nested card-layout.
- Autosparade fritextfalt anvander lokal draft-skydd per TU-inspection.
- TU-komponenter ska kunna anvandas utan att OB-access finns.
