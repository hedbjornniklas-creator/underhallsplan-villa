# Underlag per atgard

## Drift

Kor `docs/db/2026-09-09_02_action_case_scope_attachments.sql` fore driftsattning av koden.
Migrationen kraver befintliga tabeller for uppdrag, filer och kalkyler. Den ar transaktionell
och kan koras igen utan att aterstalla filval. Ingen befintlig delning eller offertforfragan andras.

`action_case_items.scope_attachment_ids` ar ett internt filval, inte en portalbehorighet.
NULL behaller den gamla filens atgardskoppling som standard; en tom lista betyder uttryckligen
inga filer. Flera atgarder kan anvanda samma fil. Hela omfattningen sparas med befintlig
versionskontroll. Databasen kontrollerar att filerna finns i samma organisation och uppdrag.
Nar underlaget andras eller en fil tas bort blir aldre AI-kalkylforslag inaktuella.

## Offertforfragan

Nya forfragningar forvaljer filerna fran valda arbetsmoment, utan dubletter.
Manuella tillval och bortval behalls nar arbetsurvalet andras. Sparade och skickade
forfragningar behaller sina egna filval och befintlig fryst utskicksdata.
Registrerade UE-offertdokument/offertsvar undantas fran utgaende bilageval, aven om de
anvands som internt underlag. Ingen portalbehorighet skapas automatiskt.
Den befintliga e-postgransen pa totalt 5 MB galler fortfarande.

## AI

Endast sparade val anvands. Servern laser filerna fran privat lagring, avgransat per
organisation och uppdrag. Bilder avkodas och skalas till hogst 1600 x 1600 pixlar.
PDF, Word, Excel och text skickas som filinnehall via befintligt Responses-anrop med
`store: false`. PDF kan inkludera sidbilder; Word/Excel behandlas framst som text/data,
inte som fullstandiga ritningsbilder. Ingen extern fil-URL fran klienten foljs.

Hogst 50 filer kan kopplas till ett moment. AI-underlaget ar begransat till 20 filer
och totalt 25 MB originaldata. Saknade, olasbara eller for stora val stoppar genereringen;
de hoppas inte over tyst. Befintliga kalkylrader och priser andras inte av genereringen.
Filinnehall behandlas som underlag, inte instruktioner. Fotoproportioner far inte anvandas
som uppmatta mangder. Explicita dokumentmatt ska kunna sparas tillbaka till filnamn och
berakning i forslagets anteckningar. Priser maste fortfarande hamtas/kontrolleras separat.

## Verifiering

- `node --test test/action-cases*.test.mjs`
- `node scripts/test-action-case-costing-ui.mjs`
- `npx tsc --noEmit --incremental false`

UI-testet anvander produktionskomponenter med syntetiska data i mobil- och datorbredder.
AI- och e-postanrop ar mockade. Det gor inga kundutskick eller betalda AI-anrop.
