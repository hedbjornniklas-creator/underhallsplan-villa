# Instruktioner per moment

## Beslut 2026-11-14

Anvandaren har bestallt en separat flik Instruktioner i Projektarbete.
Den innehaller instruktionstext, bilder och dokument och ska kunna uppdateras
aven nar momentet ingar i ett avtal som ar last for signering eller signerat.
Den avtalade omfattningen, kundpriserna, den interna kalkylen och avtalet far
inte andras av instruktionerna. Ingen automatisk delning eller PDF-export ingar.

## Avgransning

- Fliken finns bredvid Omfattning och Kalkyl i momentets befintliga sidopanel.
- Text och filval autosparas med versionskontroll och exakta aterforsok.
  Historiken visar tidigare text, filurval, serverdatum och intern avsandare.
- Ladda upp anvander Gizmos befintliga privata projektlagring och filvalidering,
  med hogst 25 MB per fil. Projektfiler och dagboksbilder kan valjas direkt.
  Hogst 50 bilagor och 12000 tecken kan sparas i en version.
- Bifogade filer har inga extra valrutor. Att ta bort en fil fran instruktionerna
  andrar bara aktuellt filurval; originalet och tidigare versioner finns kvar.
- Bildbanken ateranvander projektets befintliga dagboksbildlista, bildkomponent
  och granskningsvisare. Ingen extra bildlagring eller publik lank skapas.
- Bilagor kopplas inte via scope_attachment_ids eller action_case_item_id.
  De blir inte kalkylunderlag, avtalsbilagor eller utskicksfiler automatiskt.
- Den nya lagringen ligger i action_case_instruction_versions och
  action_case_instruction_files. Momentets updated_at andras inte.
- Aktiva interna organisationsmedlemmar med Gizmo-behorighet kan lasa och andra.
  Bestallarlankar, fragelankar, QR-besokare och andra organisationer far ingen atkomst.
- Avslutade eller avbrutna projekt visas skrivskyddat. Ett last avtal ar inte
  samma sak som ett avslutat projekt och stoppar inte instruktioner.
- Historikens filreferenser skyddar original fran radering i vanlig filhantering.
  Radering av ett olast moment kan fortfarande ta bort momentets instruktioner;
  projektfilerna behalls. Avtalslasets befintliga skydd kring momentet andras inte.

Instruktioner ar arbetsunderlag. En instruktion som faktiskt andrar den avtalade
omfattningen ska inte anvandas som ett dolt satt att andra avtalet eller bestalla ATA.
Avtalets och ATA-delens befintliga floden galler fortfarande.

## Installation

Kor `docs/db/2026-11-14_02_work_instructions.sql` fore matchande publicering.
Den ar tillaggande och aterkorbar och skriver inte om befintliga moment, avtal,
offertutkast, kalkyler eller filer. Den kraver befintlig projekt- och dagbokslagring.
Ingen SQL har korts i produktion som del av utvecklingsarbetet.

## Verifiering

- `node --experimental-strip-types --test test/action-cases-work-instructions*.test.mjs`
- `node node_modules/typescript/bin/tsc --noEmit -p test/tsconfig-work-instructions.json`
- `node --experimental-strip-types scripts/test-work-instructions-ui.mjs --test`

Databastesterna provar avtalslast moment, historik, privata fragfiler, annan
organisation, inaktiv medlem, samma begaran efter forlorat svar, samtidiga versioner,
avslutat projekt och oforandrade verksamhetsdata. UI-provet anvander riktiga
produktionskomponenter med en syntetisk transport pa loopback, utan skarpa data,
databasatkomst eller mejl. Det provar bildbank, befintlig bildvisare, uppladdning,
omedelbar stangning, aterstallt aterforsok efter omladdning, konflikt och mobilvy.
