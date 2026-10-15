# TU: datum och tid i uppdragsbekraftelsen

Beslut 2026-10-15: datum och tid ska kunna redigeras i samma TU-bekraftelse
innan kunden har godkant. En ren tidsandring ska inte skapa ett nytt uppdrag,
makulera den tidigare bekraftelsen eller skicka ett automatiskt mejl.

## Arbetsflode

- Oppna uppdragsbekraftelsen och valj **Andra datum och tid** under **Tid och pris**.
- Andringar autosparas med den befintliga `useAutosaveQueue`, efter 650 ms.
- Datum kravs vid en tidsandring; tid ar valfri. Priset redigeras inte har.
- **Klart** ar tillganglig nar andringarna ar sparade.
- For skickade bekraftelser finns **Meddela kunden**, foljt av en explicit
  bekraftelse med mottagare och den sparade tiden.
- Meddelandet skickas via den befintliga mejlprovidern och loggas i
  `outbound_messages`. Det innehaller ingen ny godkannandelank.
- Befintliga lankar, giltighetstider, villkor och status lamnas ororda.
  En redan utgangen eller aterkallad lank ateraktiveras inte.
- Utkast far inget separat tidsmeddelande. De skickas med ordinarie funktion.
- Godkanda, bokade, startade, arkiverade och avbrutna bekraftelser kan inte
  tidsandras har. OB:s befintliga flode ar inte andrat.

## Sparning och fel

- Sparning och meddelande ar separata anrop. Ett mejlfel angrar inte sparandet.
- Datum/tid och `expectedUpdatedAt` skickas till den organisationsbundna
  `/api/tu/assignments/[id]/schedule`-routen.
- Uppdateringen kontrollerar version, status och avsaknad av godkannande
  aven i databasskrivningens villkor. En konkurrerande andring ger konflikt,
  inte en overskrivning.
- Fel visas med HusHubs befintliga morka toast. Osparade falt behalls med
  mojlighet att forsoka igen eller aterstalla. Aktuell version kan hamtas
  efter en konflikt.
- Lankar, sidans tillbakaknapp, organisationsbyte och omladdning skyddas
  medan andringar ar osparade. Webblasarens historiknavigering ar inte en
  transaktionell spargaranti.
- Utskick anvander en idempotensnyckel per uppdrag, sparad version och
  mottagare inom mejlproviderns idempotensfonster.

## Verifiering

`node --experimental-strip-types --test test/tu-assignment-schedule.test.ts`

`node scripts/preview-tu-schedule.mjs`

Testvyn anvander den riktiga editorn med syntetiska svar, inklusive langsamma
anrop, sparfel, mejlfel, samtidiga andringar och godkannande i annan flik.
Inga riktiga mejl skickas. Ingen SQL-migration kravs.
