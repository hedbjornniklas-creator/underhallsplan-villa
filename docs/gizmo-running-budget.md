# Gizmo: Lopande Rakning Med Budget

## Beslut 2026-11-03

Ett projekt med ofullstandiga underlag ska kunna offereras som lopande rakning
med en separat planeringsbudget per moment och totalt. Budgeten ar ett eget
begrepp i systemet, inte en ometikettering av fast pris, ungefarlig prisuppgift
eller takpris. Kundens prisgrunder, timpriser och paslag styr debiteringen.

Anvandaren har godkant kod- och textforslaget. Automatisk bevakning av utfall
och prognos har uttryckligen skjutits upp. Ingen publicering, produktions-SQL
eller andring av Gashagas offert har bestallts i detta steg.

## Omfattning

- Prisform har ett uttryckligt val Lopande rakning med budget. Befintligt
  blandat fast/lopande pris kan ocksa fa budget for den lopande delen.
- Budgetbelopp fylls i pa momentraderna. Tomt ar okant; uttrycklig nolla ar
  noll. Totalbudgeten ar summan av de lopande momentens budgetar samt eventuell
  fast del, raknad exakt en gang. Den ar aldrig en fast kontraktssumma.
- Hamta fran Projektarbete kopierar uttryckligen valda kundpriser till budget
  for lopande moment. Interna kostnader och tidigare fasta belopp skrivs inte
  over. En senare andring av kalkylen reviderar inte budgeten automatiskt.
- Budgetens forutsattningar/osakerheter och uppfoljning/samrad ar redigerbara,
  kundsynliga texter. Standardforslaget tar upp risk for overskridande, samrad,
  dokumenterat beslut och separat overenskommelse om senare fast pris.
- Budget och ungefarlig prisuppgift kan inte vara aktiva samtidigt. Ett byte
  som tar bort befintlig budget eller ungefarlig prisuppgift kraver bekraftelse.
- Offertens kundvy och PDF redovisar samma budget, prisgrunder och texter.
  Befintliga publicerade och lasta dokument skrivs inte om. Senare fast pris
  maste overenskommas separat; ett klick i ett internt utkast ar inget kundbeslut.

## Lagring Och Skydd

Den befintliga prisformen behaller `fixed`, `running` och `mixed`. Den separata
valfria `contractPricing.budget` innehaller versionsnummer, moment-ID/belopp,
forutsattningar och samradstext. Uttrycklig null avaktiverar budgeten; avsaknad
av nyckeln bevarar aldre dokuments format. Inga befintliga datarader migreras.

`2026-11-03_01_running_price_budget.sql` validerar format, belopp, referenser och
kompletta villkor vid utskick samt hindrar aldre klienter att tyst radera budgeten.
Den andrar inga behorigheter, mottagare, avtalssummor eller betalningsplaner.
Databassteget maste koras fore eventuell publicering. API kontrollerar att den
nya budgetvalideringen finns innan formatet sparas.

## Kvar Utanfor

Automatiska varningar, bokforing, utfall/prognos, budgetrevisionsregister och
nytt godkannandeflode byggs inte nu. Befintliga versions- och lasskydd anvands.
Standardtexten ar ett produktforslag som bor granskas av entreprenadjurist.
Benamningen budget garanterar inte ensam en viss juridisk klassificering och
andra prisgranser eller konsumenttjanstlagens skydd upphavs inte av funktionen.
