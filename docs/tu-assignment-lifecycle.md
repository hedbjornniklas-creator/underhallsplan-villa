# TU: uppdragsbekraftelser

## Beslut 2026-10-15

TU:s oversikt, lista och detaljsida ska ha samma statusbegrepp och atgarder som
anvandaren kanner igen fran OB. Befintliga mejl-, lank-, arkiv- och
godkannandefunktioner ateranvands. OB:s beteende andras inte.

Anvandaren har uttryckligen valt att TU tills vidare ska krava kundgodkannande
innan en utredning startas fran en uppdragsbekraftelse. OB:s sarskilda flode for
tidig start, leveranssparr och efterfoljande avstamning infors inte i TU.

## Implementerat

| Tillstand | Visning och atgard |
| --- | --- |
| Oskickat utkast | Redigera uppgifter, andra datum/tid, skicka, arkivera |
| Skickat, giltig oanvand lank | Invantar kund; skicka om eller skapa ny version |
| Utgangen/saknad/stangd lank | Fornya och skicka; ar inte automatiskt ett avslutat uppdrag |
| Registrerat kundgodkannande | Godkand av kund; acceptera uppdrag eller starta utredning |
| Besiktningsmannen har accepterat | Godkand och accepterad; starta utredning |
| Utredning finns | Oppna utredningen; bekraftelse- och utredningsstatus visas separat |
| Avbokat | Kundens oanvanda lank stangs; bekraftelsen arkiveras; rapporten raderas inte |
| Arkiverat | Aterfor fran arkiv; en tidigare avbokning atertas inte |
| Saknade statusdata | Status behover hamtas/kontrolleras; inget godkannande antas |

Godkannande verifieras mot `assignment_acceptances`, inte enbart `status`.
Lankstatus lases fran `assignment_links`. Inga publika token returneras av
statuslasningen. Alla lasningar och atgarder begransas till vald organisation
och TU. Gemensamma atgarder kontrollerar versionen innan de utfor en andring.

Detaljsidan visar de senaste 20 mejlloggarna med mottagare, tid, meddelandetyp
och verklig utskicksstatus. "Skickat" betyder accepterat av mejltjansten, inte
last eller garanterat levererat till inkorgen. Loggfel visas som okand status,
inte som att inget mejl skickats. Tekniska kundlankfel anvander befintlig komponent.

## Skillnad mellan omskick och ny version

- **Skicka om/fornya:** samma uppdrag, men befintlig utskicksfunktion skapar en ny
  godkannandelank. Den tidigare oanvanda lankens giltighet upphor. Dialogen anger
  detta och mottagaren innan nagot mejl skickas.
- **Skapa ny version:** befintlig reissue-funktion kopierar till ett redigerbart
  utkast och avbokar foregaende bekraftelse. Kundkoppling och bakatreferens
  bevaras i TU. Ingen automatisk utsandning. Kunden maste godkanna den nya versionen.
  Funktionen erbjuds inte efter att utredningen har startats.
- **Skicka godkannandebekraftelse igen:** ateranvander befintlig TU-funktion med
  godkannandepayload och utfardarsnapshot. Ingen ny godkannandelank skapas.
  Om villkor eller utfardarsnapshot inte kan verifieras blockeras utskicket.
  Detta ar inte OB:s arkiv for exakt historiskt PDF-original.
- **Skicka uppdragsaccept igen:** separat kvitto pa besiktningsmannens accept,
  tillgangligt efter accept. Ett misslyckat mejl aterstaller inte sparad accept.

Datum och tid behaller den tidigare separata autosparningen fore kundgodkannande.
Den andrar inte lank och skickar inget mejl automatiskt. Andringar i exempelvis
omfattning eller pris efter utskick kraver ny version, precis som i OB.
Krav pa objektuppgifter vid kundens godkannande ar oforandrade.

## Fel och begransningar

- Ingen generell PATCH kan satta kunden till godkand eller startad.
- Gamla flikar kan inte skriva over en nyare version. Osparade tidsandringar
  blockerar andra atgarder. Redigeringsdialogen bevarar text vid sparfel.
- Avbokning skickar inte kundmejl; detta anges i dialog och resultat.
- Mejltjanst och databas ar inte en gemensam transaktion. Vid osakert resultat
  uppmanas anvandaren att uppdatera status och kontrollera loggen fore nytt forsok.
- Vid ett partiellt fel efter avbokning bevaras det nya TU-utkastet, sa att den
  enda anvandbara ersattningen inte tas bort.
- Inga nya SQL-migrationer behovs.

## Verifiering

`test/tu-assignment-lifecycle.test.ts` provar statusmatrisen, versionskontroll,
org-/origin-granser, redigeringsfalt, mejlfel och historiklasningens paginering.
Befintliga tester for TU-datum, kundgodkannande, organisationsatkomst och OB:s
redigeringslas kor tillsammans med dessa. Lokal UI-testvy:
`node scripts/preview-tu-assignment.mjs --port 60110`.
Vyn anvander riktiga React-komponenter men syntetiska data och blockerad extern trafik.
