# Knapp-plan for OB-modulen

Denna plan beskriver hur knappar i OB-modulen ska fargsattas efter funktion. Syftet ar att undvika svarta knappar och gora atgardernas betydelse konsekvent mellan uppdragsbekraftelse, besiktningsrunda, bildbank, installningar och rapportflode.

## Grundprinciper

- Knappar ska fargsattas efter funktion, inte efter sida.
- Svart eller nara svart (`bg-black`, `bg-gray-900`, `hover:bg-black`) ska inte anvandas for vanliga knappar, aktiva filter eller val.
- Morka overlays over bilder eller modaler far anvandas nar de ar bakgrund/kontrastyta, inte som knappvariant.
- Disabled-lagen ska ha explicita farger nar knappen annars ar starkt fargad. Anvand inte enbart lag opacity for viktiga knappar.
- Statusfarger far vara semantiska och ska inte blandas ihop med primara atgarder.

## Funktionella knappvarianter

| Funktion | Rekommenderad farg |
| --- | --- |
| Primar atgard: skapa, spara, skicka, fortsatt | `bg-indigo-600 text-white hover:bg-indigo-700` |
| Sekundar atgard: tillbaka, avbryt, stang | `bg-white border-slate-300 text-slate-700 hover:bg-slate-50` |
| Aktivt neutralt val/filter/flik | `border-indigo-600 bg-indigo-600 text-white` |
| Destruktiv atgard: ta bort, avbryt uppdrag | `bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100` eller `bg-rose-600 text-white` for skarp destruktiv primar |
| Varning/aterskick/kraver uppmarksamhet | `bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100` |
| Framgang/slutfort/godkant | `bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100` eller `bg-emerald-600 text-white` for primar slutfor-knapp |
| Bild/kamera/uppladdning/bildval | `bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100` for sekundara bildatgarder, `bg-sky-600 text-white hover:bg-sky-700` for primar bildatgard |
| AI/smart sok | `bg-violet-600 text-white hover:bg-violet-700` |
| Inaktiv/disabled primarknapp | Exempel: `disabled:bg-indigo-50 disabled:text-indigo-700 disabled:ring-1 disabled:ring-indigo-200` |

## Statusknappar

Statusknappar och statusflikar far behalla egna semantiska farger:

- Utkast: ljus slate/gra
- Skickad: bla
- Bestalld/godkand: gul
- Bokad/accepterad: orange
- Slutford: gron
- Avbruten: rod
- Utgangen/arkiverad: gra

Aktivt statuslage ska ha tillracklig kontrast och far anvanda morkare nyans av sin statusfarg. Det ska inte anvanda svart som standard.

## OB-ytor som ska folja planen

- Uppdragslista och uppdragsbekraftelse
- Ny och uppdaterad uppdragsbekraftelse
- OB-startsida
- Besiktningsrundan
- Utsida och insida
- Bildbank och bildurval
- Kontrollpunktssok och AI-sok
- Rapportgranskning och utskrift
- Installningar

## Kanda tillampningar

- Primara spara/skicka/starta-atgarder ska vara indigo.
- Kontrollpunktssokets AI-atgard ska vara violet.
- Bildbankens markeringar och kopplingsatgarder ska vara sky.
- Aktiva filter och chip-val ska vara indigo nar de inte ar status- eller bildspecifika.
- Svarta/morkgra primar- eller aktivknappar ska ersattas med ovanstaende varianter.
