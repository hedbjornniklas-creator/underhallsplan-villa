# TU: uppdragsbekraftelser

## Beslut 2026-10-15

TU:s oversikt, lista och detaljsida ska ha samma statusbegrepp och atgarder som
anvandaren kanner igen fran OB. Befintliga mejl-, lank-, arkiv- och
godkannandefunktioner ateranvands. OB:s beteende andras inte.

Beslutet har senare samma dag andrats av anvandaren: TU ska, likt OB, erbjuda
uttrycklig start fore kundgodkannande. Det innebar inte att kunden har godkant
eller att besiktningsmannen har accepterat uppdraget.

## Implementerat

| Tillstand | Visning och atgard |
| --- | --- |
| Oskickat utkast | Redigera uppgifter, andra datum/tid, skicka, arkivera |
| Skickat, giltig oanvand lank | Invantar kund; starta fore godkannande, skicka om eller skapa ny version |
| Tidigt startat | Arbeta vidare; slutleverans sparrad tills godkannande, accept och avstamning ar klara |
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
  For en tidigt startad utredning behalls samma utredning och allt arbetsmaterial.
  Arbetet pausas tills den nya bekraftelsen ar skickad med en giltig kundlank.
  For andra redan startade utredningar erbjuds funktionen inte.
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
- Tidig start kraver `docs/db/2026-10-15_02_tu_early_start.sql` fore driftsattning.
  Den ateranvander OB:s snapshot och befintliga tokenlasning fran
  `2026-09-10_02_ob_early_start.sql`. Migrationen skriver inte om befintliga
  utredningar, kundgodkannanden, lasningar eller rapporttexter.

## Tidig start

- Endast ansvarig besiktningsman eller aktiv organisationsadministrator far starta.
- Uppdraget maste vara skickat, oarkiverat, utan godkannande och med giltig kundlank.
- Anvandaren valjer mall, anger anledning och bekraftar att slutleverans ar sparrad.
- Skapandet ar transaktionellt och aterforsok oppnar samma utredning.
- Kundens senare godkannande sparas med befintligt tokenflode. Ingen automatisk
  overskrivning av grunduppgifter, faltposter, bilder, matningar eller rapporttext.
- Besiktningsmannen accepterar uppdraget pa bekraftelsesidan och oppnar sedan
  **Stam av uppdraget** i utredningen. Vyn jamfor startuppgifter, godkanda
  kunduppgifter och utredningens grunduppgifter. Skillnader hanteras manuellt.
  Till skillnad fran OB:s selektiva import finns ingen automatisk faltimport i
  detta TU-steg. Rapporten maste ocksa kontrolleras, eftersom dess manuellt
  redigerade uppgifter kan skilja sig fran grunduppgifterna.
- Avstamningen lagrar aktor, tid, godkannandepost och snapshots. En inaktuell
  jamforelse avvisas, aven om rapporttext har sparats i en annan flik.
- Faststallande, rapportlankar, revisioner, utskick och publicerad PDF skyddas
  i API och databas. Intern PDF-forhandsgranskning marks som utkast.
- Avbokad, arkiverad eller oskickad ersattningsbekraftelse, eller utgangen
  oanvand kundlank, pausar arbetet. Ingen befintlig observation raderas.

## Beslutslogg

- 2026-10-15: Anvandaren valde initialt att behalla kundgodkannande fore start.
- 2026-10-15, senare: Anvandaren bad uttryckligen om start fore godkannande likt OB.
  Det ersatter tidigare begransning, med bibehallen sparr mot slutleverans.

## Verifiering

`test/tu-assignment-lifecycle.test.ts` provar statusmatrisen, versionskontroll,
org-/origin-granser, redigeringsfalt, mejlfel och historiklasningens paginering.
Befintliga tester for TU-datum, kundgodkannande, organisationsatkomst och OB:s
redigeringslas kor tillsammans med dessa. Lokal UI-testvy:
`node scripts/preview-tu-assignment.mjs --port 60110`.
Vyn anvander riktiga React-komponenter men syntetiska data och blockerad extern trafik.

`test/tu-early-start.test.ts` kor migrationen tva ganger i en lokal Postgres-motor
och provar tidig/normal start, sent godkannande med verklig tokenkonsumtion,
leveranssparr, versionskontroll, omskick och bevarat arbetsmaterial.
