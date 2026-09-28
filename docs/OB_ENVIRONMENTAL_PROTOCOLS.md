# Radonindikering och mögelprov

## Omfattning

Första versionen tillför två gemensamma moment efter byggnadernas ÖB-rundor.
Momenten visas när motsvarande tillägg valts i Fastighet & uppdrag, via
`inspection_addon_orders` eller äldre `scope`. Varje mät-/provplats anger byggnad
och våningsplan/rum som fritext. Samma formulär används för alla byggnader;
det finns inte en separat implementation för garage.

- Radon: objektuppgifter, instrument, mätperiod, platser, värden i Bq/m³,
  valfri mätosäkerhet, kommentarer och bedömning.
- Mögelprov: omfattning, laboratorium, analysrapport, prov-ID, provplats,
  tidpunkt, metod, status, laboratoriets resultat och separat bedömning.
- Autospar efter 700 ms. Ingen sparad-toast eller fokusflytt. Lokala utkast
  återställs; versionskonflikter kräver ett uttryckligt val.
- Låsta och pausade besiktningar får inte ändras genom de nya API:erna.
- PDF-original kan bifogas, kopplas bort och återkopplas. Max 4 MB/fil och
  20 kopplade filer per protokoll. Bortkoppling raderar inte originalet.

## Underlag och avgränsning

Radon bygger på den sparade SBR-mallen
[Bilaga Radonindikering 2026.1](https://docs.google.com/document/d/1BFfbPhaKbJUgrDOW_ZSOTmamO2IyN7Yu/edit).
Mallens indikationsförbehåll och hänvisning till uppdragsvillkor är versionsbundna
i koden och kopieras vid publicering. Layouten är anpassad till rapportvisaren,
inte en identisk DOCX-faksimil. Ingen automatisk friskförklaring, gränsvärdesbedömning
eller antagen mätosäkerhet görs.

Ingen separat SBR-mall för mögelprov hittades i det genomgångna underlaget.
Mögeldelen är därför ett eget provtagningsprotokoll, inte märkt som SBR-mall.
Ett inväntat svar är uttryckligen inte ett negativt resultat. Analyserade prov
kräver resultat, laboratorium och analysrapportens nummer innan de kan publiceras.
Detta ersätter inte laboratoriets metod/anvisningar eller originalrapport.

## Rapporter och historik

`Ta med i utlåtandet` är av som standard. Ofullständiga markerade protokoll
blockerar rapportgenerering med konkreta fel; omarkerade protokoll utelämnas.
Nya bilagor får nummer efter befintliga standardbilagor, area och fukt.
Både rapportförhandsvisning och publicering använder samma protokollbyggare.

Vid publicering kopieras resultat, texter, filnamn, lagringssökvägar, storlekar och
SHA-256 till rapportens befintliga snapshot. PDF-specifikationen fryses samtidigt.
Den digitala kundvyn och filnedladdningen läser endast denna snapshot.
Senare protokolländringar, uppladdningar eller bortkopplingar ändrar inte historiken.
SQL-filen backfillar eller uppdaterar inga besiktningar eller rapporter.

Laboratoriets/mätinstrumentets PDF är en **separat originalbilaga** som kunden
kan ladda ner i det digitala utlåtandet. Den bäddas inte in som extra sidor i
utlåtandets PDF och skickas inte automatiskt som egen mejlbilaga. Utlåtandets
PDF anger de separata filernas namn. Ingen automatisk tolkning av laboratoriesvar.

## Databas och driftsättning

Kör `docs/db/2026-09-28_01_ob_environmental_protocols.sql` före publicering.
Förutsätter befintlig tilläggskatalog och `ob_building_access`/`ob_round_mutate`.
SQL skapar:

- `inspection_environmental_protocols`, en versionerad JSON-post per besiktning/tillägg.
- `inspection_environmental_files`, oföränderliga originalreferenser.
- Privat bucket `ob-environmental-files` och service-only RPC med ägar-,
  organisations-, lås- och revisionskontroll. Klienter kan inte direkt skriva tabellerna.
- Saknade katalogposter för radon/mögel, utan att skriva över befintliga namn,
  alias eller inaktiveringar. Ingen besiktningsmans erbjudanden/priser aktiveras automatiskt.

Aktivera erbjudandena och ange pris i besiktningsmannens befintliga
tilläggsinställningar när de ska kunna beställas. Befintliga uppdragsbekräftelsers
pris- och urvalssnapshots ändras inte. Redan skapade besiktningar med ett fryst
tilläggsurval får inte automatiskt nya beställningar.

Uppladdningar får alltid en ny UUID-sökväg (`upsert: false`). SHA-256 kontrolleras
vid nedladdning. En tappad registreringsrespons kan lämna ett privat, orefererat
objekt; det raderas inte automatiskt eftersom registreringen kan ha lyckats.
Återkallad kundlänk ger inte åtkomst till dess bilagor.

## Verifiering

Endast syntetiska data har använts. Ingen SQL eller uppladdning har körts i produktion.

```powershell
node --test test/ob-environmental.test.ts test/ob-environmental-api.test.ts test/ob-environmental-sql.test.ts
node scripts/preview-ob-environmental.mjs --test
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Testerna täcker validering, behörighet, upprepbar migration, låsning, konkurrerande
versioner, filisolering, oföränderliga snapshots, bortkoppling/återkoppling och
avvisade uppladdningar. Webbläsartest vid 320/390/768/1440 px samt 200 % text,
fokus/scroll vid autospar, återställning efter nätfel, konfliktval och PDF-sidbrytning.
Rapporter och skärmbilder finns lokalt i `tmp/ob-environmental-preview`.

Efter SQL och publicering återstår ett inloggat röktest i en särskild testbesiktning:
välj tilläggen, fyll i, ladda om, bifoga en test-PDF, publicera till en testmottagare
och kontrollera båda bilagorna samt filnedladdningen via kundlänken.
