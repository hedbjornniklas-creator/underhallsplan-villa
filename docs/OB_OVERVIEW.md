# Gemensam uppdragslista för ÖB

Implementerad 2026-09-23. Publiceringsunderlag och verifieringsgränser finns i
[OB_OVERVIEW_RELEASE.md](OB_OVERVIEW_RELEASE.md).

## Omfattning

`/ob` har en ny lista, **ÖB-uppdrag**, under de fyra befintliga korten.
De gamla listorna `/ob/assignments` och `/inspections` samt deras funktioner
finns kvar. På skärmar under 1024 px samlas korten under **Genvägar**.

Listan följer [varumärkesprofil 1.2](OB_BRAND_PROFILE.md): blå handlingar,
Manrope, neutrala statustexter och vita rader med tunna avdelare. Mobilen
använder samma rader och länkar i en vertikal layout utan sidscroll.
De äldre kortens interna utseende är inte ombyggt.

### Visuell uppföljning 2026-09-24, lokalt för utvärdering

- Bredare listyta (sidbehållare upp till 1856 px), utan att bredda övriga moduler.
- Dator: 14/20 px genom tabellen, egna kund-/nummerkolumner och 56 px standardrader.
- Långa värden trunkeras visuellt, men full text och åtgärdsorsaker kan öppnas
  i en detaljrad med mus eller tangentbord. De finns även i ikonernas/cellernas tooltip.
- Två 44 px ikonlänkar för befintliga flöden. Statusar och länkadresser är oförändrade.
- En containerstyrd staplad layout behåller fullständiga texter, synliga
  åtgärdslänkar och 48 px kontroller när bredd eller textstorlek kräver det.
- Klicktestet kontrollerar även 1920 px, jämna rader, gemensam textstorlek,
  utnyttjad bredd och utfällda detaljer med långa texter. Ingen ny SQL.

## Datakoppling och åtkomst

- `GET /api/ob/overview` använder samma organisationskontext som den befintliga
  uppdragslistan och läser bara `assignment_type = OB`.
- Besiktningar läses med användarens Supabase-klient och RLS, dessutom med
  den äldre besiktningslistans filter på fastigheter som användaren äger och
  `inspection_family = OB`. Admin-klienten används inte för denna läsning.
- Besiktningens objektsnapshot prioriteras före fastighetens aktuella uppgifter.
- Bekräftelser och besiktningar kopplas bara genom ID, aldrig kundnamn/adress.
  Flera besiktningar på samma fastighet är separata uppdrag.
- Vid tidig start/ersättning är `ob_assignment_workflows.current_assignment_id`
  den aktuella bekräftelsen. Äldre versioner skapar inte extra aktiva rader.
  Historiken raderas inte och de gamla ingångarna finns kvar.
- Besiktningar utan kopplad bekräftelse finns kvar med **Ingen kopplad**.
  En bekräftelse vars besiktning inte finns i användarens tillåtna urval visar
  **Ej tillgänglig**, utan besiktningslänk eller dolda besiktningsuppgifter.
- Saknad/oväntad besiktningsstatus visas uttryckligen, inte som automatiskt
  pågående eller avslutad. Tvetydiga ID-kopplingar utan arbetsflödets pekare
  slås inte ihop på gissning; de separata posterna behålls för kontroll.
- Läsfel ger ett fel med återförsök, aldrig en tyst ofullständig lista.
  Vid fel efter uppdatering märks den tidigare listan som senast hämtad.
- Svaret har `private, no-store`. API:t tillhandahåller inga skrivkommandon.

## Två oberoende statusar

| Bekräftelsedata | Visning |
| --- | --- |
| `draft` | Utkast |
| `sent`, inte godkänd, giltig oanvänd länk | Inväntar kund |
| `sent` utan giltig oanvänd länk | Länk behöver förnyas |
| `expired` | Länken har gått ut |
| `accepted_at` med motsvarande `assignment_acceptances` | Godkänd av kund |
| Verifierat kundgodkännande och `booked_at`, status `booked`/`completed` | Godkänd och accepterad |
| `cancelled` | Avbokad |
| Annan/motsägande godkännandedata | Godkännande behöver kontrolleras |

Arkiverad bekräftelse märks också som arkiverad. `completed` på bekräftelsen
betyder **inte** att besiktningen är klar. Besiktningsstatus kommer enbart från
besiktningsposten: Utkast, Pågår, Klar eller Arkiverad, med befintliga stavningsvarianter.
Klar är inte ett nytt påstående om rapportleverans.

Tidig starts avstämningsbehov/paus hämtas från den befintliga serverfunktionen
`ob_assignment_workflow_state`, inte en ny kopia av reglerna. Ändras pekaren
under läsningen krävs omladdning i stället för att blanda två versioner.

## Filter och åtgärder

- **Alla**: ej arkiverade uppdrag, även avbokade. Arkiverade kan visas separat.
- **Aktuella**: besiktningen är inte klar/arkiverad, eller en fristående
  bekräftelse som inte är avbokad/arkiverad. Utgångna bekräftelser är aktuella.
- **Avslutade**: klar/arkiverad besiktning eller avbokad/arkiverad fristående
  bekräftelse. Avbokad bekräftelse stänger inte en pågående besiktning i listan.
- **Kräver åtgärd**: utkast att färdigställa, utgången/ogiltig länk, kundgodkänt
  uppdrag att acceptera, kvarstående tekniskt länkfel, okänd status eller
  tidig starts paus/avstämning. Att enbart invänta kunden räknas inte som en
  åtgärd för besiktningsmannen. Orsaken skrivs ut på raden.
- Markeringens prioritet är arkiverad, åtgärdsbehov, avslutad, aktiv besiktning,
  övrigt. Statusarna och orsakstexten fungerar även utan färg.
- Sökningen omfattar adress, ort, kund och uppdragsnummer. Datum sorteras med
  odaterade sist; lika datum får stabil ID-ordning. Sidstorlek 10/25/50.
- **Öppna besiktning** går till befintlig besiktning. **Öppna bekräftelse**,
  **Acceptera uppdrag** och **Starta besiktning** går till den befintliga
  bekräftelsesidan. Accept/start måste därefter utföras med befintliga
  kontroller; ett klick i listan accepterar eller skapar aldrig något.
- Listan uppdateras efter snabbskick från kortet, när sidan återfår fokus,
  samt med uppdateringsknappen. Äldre svar får inte skriva över nyare svar.

## Drift och verifiering

Ingen ny SQL-migrering. Befintliga tabeller för tidig start, godkännanden och
länkincidenter måste finnas, precis som för motsvarande befintliga funktioner.
Databasläsningar hämtas i ordnade sidor om 500 poster och ID-filter i grupper
om 100, så Supabases standardgräns inte tyst kapar listan vid 1000 poster.
Arbetsflödets avstämningar läses med högst fyra samtidiga anrop.

Den första versionen filtrerar/sorterar det behöriga underlaget i klienten.
Vid större volymer bör samma modell flyttas till serverpaginerad aggregering,
utan att ändra statusarnas betydelse. Den är inte prestandatestad för stora
organisationer med tusentals tidigt startade arbetsflöden.

```powershell
node --experimental-strip-types --test test/ob-overview.test.ts
node scripts/preview-ob-overview.mjs --test
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
```

Browserprovet använder den riktiga startsidan/listkomponenten, men en separat
Supabase-stub och fiktiva uppdrag. Inga kundmejl skickas eller data sparas.
Det kontrollerar 320/360/390/430/768/1024/1280/1440 px, 200 % text, genvägar,
sökning, filter, länkar, sidbläddring, laddning, tom lista, återförsök och
avbrutna äldre svar. Skärmbilder hamnar under `tmp/ob-overview-preview/`.

Verifierat 2026-09-23:

- 22 nya domän-/läs-/API-testfall godkända; 37 totalt med relevanta befintliga
  tester för modulavgränsning, tidig start, profil och startsidans guide.
- Browserprovet ovan godkänt och dator-/mobilskärmbilder visuellt granskade.
- TypeScript och riktad ESLint godkända. Produktionsbyggning godkänd med två
  befintliga varningar om breda filberoenden i `renderPreviewPdf.ts`.
- Lokal Next-app svarar på `/ob`. Anonymt anrop till `/api/ob/overview` ger
  HTTP 401 och `Cache-Control: private, no-store`.
- Laddnings-/åtkomstfel är bestående listtillstånd enligt
  [UI_FEEDBACK_STANDARD.md](UI_FEEDBACK_STANDARD.md), inte tillfälliga toasts.

Användaren har godkänt publicering. Den isolerade produktionsbyggningen och
klicktesterna är godkända. Ett avgränsat, skrivskyddat läsprov mot produktionens
databas gav 86 rader, varav 41 med besiktning. Det använde admin-klienten och
verifierar därför inte en inloggad användares RLS eller webbläsarsession.
Inloggat slutprov i produktion återstår. Ingen kundbesiktning har skapats/ändrats.
