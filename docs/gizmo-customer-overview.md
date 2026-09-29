# Gizmo: bestallarens projektoversikt och kundoffert

Status: implementerat forsta steg for kundoversikt och versionerade kundofferter.
Datum: 2026-09-29.

## Beslut och omfattning

- Bestallaren far en egen startsida. Den interna arbetsytan och UE-portalen
  behalls separat. Gemensamma data ateranvands, inte gemensamma behorigheter.
- Forsta leveransen ar offert, omfattning/tillval och delade bilder/dokument.
  Grafer for fakturering och tidplan byggs nar dessa har verkliga datakallor.
  Saknade belopp eller datum visas inte som noll eller som fiktiva framsteg.
- Kundpriser anges inklusive moms. Grundatagandet kan ha ett fast klumpsummepris
  eller fasta delpriser som summeras automatiskt. Befintliga offerter behaller
  klumpsumma; inget gammalt pris fordelas automatiskt. Saknade delpriser ar inte
  noll och blockerar publicering, men ofullstandiga utkast kan sparas.
- Varje tillval har ett eget kundpris. Valfria alternativgrupper, exempelvis
  fonsterleverantor, tillater hogst ett val per grupp och visas med radioval.
  Alternativen i samma grupp har exakt samma gruppnamn; befintliga namn foreslas
  i redigeraren. Oberoende tillval anvander kryssrutor. Ingen grupp ar obligatorisk
  i detta steg: kunden kan avsta. Arbete utanfor atagandet visas separat och
  raknas aldrig in i grundpris eller godkanda tillval.
- Kundofferten ar inte UE-forfragan eller intern kalkyl. Import av arbeten kopierar
  bara rubrik och omfattning, aldrig inkopspriser, marginaler eller UE-svar.
- Denna forsta avtalsmodell ar avsedd for referensfallet privatkund/tillbyggnad.
  ABS 18 kan valjas tillsammans med en manuellt granskad PDF-avtalshandling.
  Ingen avtalsmall, konsumentrattslig kontroll eller juridisk garanti genereras.

## Anvandarresa

1. Intern anvandare oppnar Uppdrag > Atgardsarenden > projekt > Kundvy och offert.
2. Ange rubrik, prismodell och giltighet. Hamta arbeten fran projektet eller
   lagg till dem manuellt. Markera grundatagande, tillval eller utanfor atagandet.
   Ange grundpris eller delpriser. Tillval som ar alternativ till varandra far
   samma alternativgrupp och egna priser. Granska summeringen i offertutkastet.
3. Komplettera tider, betalningsvillkor, villkor och utvalda bilagor. En PDF bland
   bilagorna maste utses till avtalshandling nar ABS 18 valts.
4. Spara utkast och granska offertutkastet. Kundens startsida visar bara det som
   redan publicerats. Osparade andringar varnas vid navigation bort fran sidan.
5. Bekrafta granskning och skicka. Servern fryser offertversion och kopior av
   bilagor innan mejlet skickas. En ny version ersatter tidigare publicerad version.
6. Bestallaren oppnar projektoversikten, granskar offert och bilagor, valjer tillval
   och bekraftar omfattning, villkor, mottagarroll och totalpris.
7. En engangskod skickas till den e-postadress som frystes med offerten. Godkannande
   binder exakt version, namn och serverlagrade tillval. Totalen beraknas pa servern.
8. Kunden ser kvittens med sparad tid och totalsumma. Internt visas versionen som
   godkand. Varken ett nytt offertutkast eller en andrad kalkyl skriver over avtalet.

## Information och behorigheter

- Intern route: `/uppdrag/[caseId]/kund`, med samma organisations- och modulbehorighet
  som Uppdrag. Kundroute: befintliga `/atgardsarende/[token]`.
- Befintliga kundportaler andras forst nar forsta kundofferten publiceras. Ett
  sparat internt utkast andrar inte kundens sida. UE-portalen behaller sitt flode.
- Privata versionstabeller saknar klientpolicies och ar endast tillgangliga via
  service-role efter API:ets behorighetskontroll. RPC-funktionerna kan inte anropas
  direkt av anon eller authenticated.
- Kunddata projiceras uttryckligen. Interna beskrivningar, kalkyler, UE-priser,
  mejlpayload, kodhashar och lagringssokvagar ingar inte i kundens data.
- UE-offertdokument kan inte publiceras som kundbilagor. Andra dokument maste valjas
  uttryckligen. Att valja en offertbilaga andrar inte befintliga filbehorigheter.
- Frysta bilagor kopieras till privat bucket `action-case-customer-offers`.
  Gamla original kan tas bort utan att avtalskopian forsvinner. Filendpoints
  kontrollerar org, projekt, mottagare, version och fil-ID; signerad URL galler 60 s.
- Befintliga kundlankar kan anvandas for senare versioner tills lankens 90-dagars
  giltighet gar ut eller den aterkallas. Varje utskick innehaller ocksa en ny lank.
  En kundlank ar en delbar bearer-lank, inte ett inloggat kundkonto.
- E-postkod bekraftar kontroll over brevlada, inte juridisk identitet eller
  fullmakt. Detta ar inte BankID eller kvalificerad elektronisk signering.

## Versioner, fel och aterhamtning

- Utkast har en revisionsraknare. Samtidiga redigeringar avvisas vid gammal revision
  i stallet for att tyst skriva over varandra. Lokal text bevaras vid sparfel.
- Publicering och godkannande serialiseras med projektlas i databasen. Publicering
  av samma utkastrevision ger samma offertversion. Gamla versioner kan lasas men
  inte godkannas nar de ersatts eller aterkallats.
- Publicerade priser, omfattning, mottagare, bilagor och mejlpayload ar oforanderliga.
  Ett accepterat avtal ar terminalt. Anvand inte nytt grundavtal for att hantera ATA.
- Befintlig mejltjanst ateranvands med sparad payload och idempotensnyckel. En
  kort sandningslease hindrar samtidiga dubbelsandningar. Vid osakert mejlsvar kan
  samma version provas igen, inte skapas pa nytt.
- Efter 23 timmar sedan forsta sandningsforsoket stoppas automatisk omsandning av
  obekraftade utskick. Admin maste kontrollera leverantorsstatus. Leverantorens
  idempotensfonster far inte overskridas med ett blint nytt forsok.
- Koder galler i 10 minuter, hogst 5 forsok, hogst en kod/minut och 5 koder/timme
  per offert. Felaktiga forsok sparas trots felmeddelandet. Ny kod ersatter gammal.
- Tillfalliga meddelanden anvander den befintliga `AppToastProvider`.
- Byte mellan offertvyer flyttar skroll och tangentbordsfokus till sidrubriken.
  Granskningen har aven en atergang till redigering langst ned. Osparade uppgifter
  bevaras vid vybyte; granskning sparar eller publicerar ingenting.
- Checklistan kontrollerar verklig text, inte enbart mellanslag. Villkor,
  betalningsvillkor och tider redovisas var for sig. Saknad mottagaradress visas
  ocksa som hinder for utskick.
- Servern beraknar grundpriset fran arbetsdelarna vid sparning i delprislage.
  Databasen verifierar summan vid sparning/publicering och avvisar flera val ur
  samma alternativgrupp vid kodbegaran och godkannande. Kvittensen anvander
  versionens frysta priser och kodbegarans sparade val, aldrig ett klienttotal.
  Publicering kraver minst tva prissatta alternativ per alternativgrupp.

## Intern priskalkyl (2026-09-29)

- Varje prissatt arbetsdel/tillval kan ha en privat kalkyl. Inkopspris anges
  exklusive moms; valfritt procentpaslag beraknas enbart pa inkopspriset.
  Ett fast paslag i kronor kan anvandas separat eller tillsammans med procent.
- Montage, maskiner och andra namngivna tillagg anges som kundbelopp exklusive
  moms. Dessa far inget ytterligare automatiskt paslag. Summeringen far 25 %
  moms; procentbelopp och moms avrundas till hela ore med heltalsaritmetik.
  Andra momssatser, omvand moms och ROT ingar inte i denna forsta modell.
- Kalkylen ar ett arbetsblad, inte offertpriset. `Anvand kundpris` kopierar den
  aktuella summan till kundprisfaltet. Senare kalkylandringar skriver inte over
  kundpriset automatiskt. Bade beraknat och nuvarande kundpris visas.
  Ett tidigare manuellt kundpris kan fortsatt anvandas.
- Saknat inkopspris eller ofullstandiga tillaggsrader ger ingen beraknad summa.
  Tomma valfria paslag ar noll; ett uttryckligt nollpris tillats. Kalkylen kan
  sparas ofullstandig och foljer samma utkastrevision som offerten.
- `internal_costing` lagras separat fran `body`. Den interna serverrutten laser
  kalkylen, men publicerade snapshots, mejl och portalprojektioner gor det inte.
  Den befintliga skrivfunktionen ateranvands i en transaktionell wrapper sa
  offert och kalkyl sparas tillsammans. Organisationskontroll, revisionskonflikt
  och lasning efter godkannande galler aven kalkylen.
- Kor `docs/db/2026-09-29_03_customer_offer_internal_costing.sql` fore aktivering.
  Saknas kolumnen visas inte kalkylfunktionen, och befintlig manuell prissattning
  fungerar fortfarande. Ett misslyckat kalkylsparande far aldrig tyst falla
  tillbaka till att bara spara den publika offerten.

## Aktivering

Releasekontroll 2026-09-29: produktionens tre offerttabeller, bada RPC-funktioner
och privata bucket finns. Anonym tabellatkomst nekas. Publiceringspaketet
innehaller de gemensamma varumarkesfilerna, men temat aktiveras bara pa de nya
kundoffertsidorna. Ovriga sidors varumarkesandringar ingar inte i denna release.

1. Kor befintliga action-case-migrationer inklusive deltagare/filer, kalkyl,
   arbetspriser och samlade UE-forfragningar.
2. Kor `docs/db/2026-09-29_01_action_case_customer_offers.sql` i en testmiljo forst.
   Migrationen ar transaktionell och omkorbar. Den skriver inte om gamla projekt,
   kalkyler, rapporter eller statusar. Nya tabeller anvander restriktiva FK:n sa
   historiska avtal inte forsvinner genom projektradering.
   Delpriser/alternativ kraver aven
   `docs/db/2026-09-29_02_customer_offer_pricing.sql` fore publicering av appen.
   Den nya migrationen lagger endast till valideringsfunktioner och triggers;
   inga offerter skrivs om. Appen avvisar sparning/publicering med de nya
   prisfunktionerna om databasskyddet saknas. Vanliga klumpsummor fungerar som tidigare.
3. Kontrollera `APP_BASE_URL` (produktionsdomann med HTTPS), `ASSIGNMENTS_MAIL_FROM`
   och `RESEND_API_KEY`. Ingen hemlighet skickas till klienten.
4. Publicera appkoden och prova intern offert -> kontrollerad testbrevlada ->
   kundlank -> bilaga -> kod -> godkannande. Testa aven en separat UE-lank och
   annan organisation. Riktiga mejl/Supabase Storage har inte anvants i lokala tester.
5. Fore anvandning med riktig bestallare: granska avtalshandlingens parter,
   organisationsuppgifter, omfattning, konsumentinformation, villkor och dokumentens
   inbordes ordning. Detta implementeringssteg ersatter inte den granskningen.
6. Vid aterstallning: behall versionsdata, privat bucket och fungerande lasning av
   redan utskickade avtal. Ta inte bort migrationen eller originalhistoriken.

## Tester

- `node --experimental-strip-types --test --test-concurrency=1 test/action-cases-*.test.mjs`
  Inkluderar PGlite med faktiska migrationer: revisioner, organisationsgranser,
  oforanderliga versioner, filreferenser, kodbegransningar, totalsummor och retries.
- `node --experimental-strip-types scripts/test-customer-offer-ui.mjs`
  Riktiga React-komponenter med fiktiv HTTP-backend. Inga riktiga mejl eller
  databasskrivningar. Klickflode, decimalpris, misslyckad sparning, ny kod/fel kod,
  kundkvittens, aterlasning, tomma/utgangna offerter, bilder och fyra skarmbredder.
- `npx tsc --noEmit --incremental false` och riktad ESLint.
- Lokal demo: `node --experimental-strip-types scripts/test-customer-offer-ui.mjs --serve`.
  Satt `PREVIEW_PORT` for fast port. Testkod: `123456`. Data finns bara i minnet.
  Lagg till `--itemized` for ett separat, uttryckligen fiktivt testfall med
  delpriser, oberoende tillval och tva alternativa fonsterleverantorer.

## Beslutslogg

- 2026-09-29: Utokat grundpriset med frivilligt delprislage och tillval med
  hogst-ett-val-grupper for referensprojektets behov. Tidigare versioners
  klumpsummor och godkannanden behalls oforandrade. El som inte projekterats och
  senare malning bestalls inte genom att anges som undantag; en senare ATA
  kraver ett separat flode. Verkliga delpriser maste anges av anvandaren.

## Senare steg, inte implementerade

- Betalplan och fakturor med tydlig skillnad mellan avtalat, fakturerat och betalt.
  Avtalad totalsumma inkluderar bara accepterade tillval/ATA, inte valfria forslag.
- Delad tidplan med milstolpar, beroenden och bara kundpublicerade datum.
- ATA och kompletterande tillval som egna godkannanden, aldrig overskrivning av
  grundavtalet. Flera bestallare/signatarer, foretagskund, flera momssatser och ROT.
- Fardig genererad avtals-PDF, automatisk godkannandekopia via mejl, kundkonton och
  starkare signering. Nu finns kvittensen i kundvyn och webblasaren kan skriva ut.
- AI-stod for offerter och fullstandighetskontroll. Inga AI-priser eller avtalsvillkor
  publiceras automatiskt i denna version.
