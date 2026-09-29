# Gizmo: bestallarens projektoversikt och kundoffert

Status: implementerat forsta steg for kundoversikt och versionerade kundofferter.
Datum: 2026-09-29.

## Beslut och omfattning

- Bestallaren far en egen startsida. Den interna arbetsytan och UE-portalen
  behalls separat. Gemensamma data ateranvands, inte gemensamma behorigheter.
- Forsta leveransen ar offert, omfattning/tillval och delade bilder/dokument.
  Grafer for fakturering och tidplan byggs nar dessa har verkliga datakallor.
  Saknade belopp eller datum visas inte som noll eller som fiktiva framsteg.
- Kundpriser anges inklusive moms. Grundatagandet har ett fast klumpsummepris.
  Varje tillval har ett eget kundpris. Arbete utanfor vart atagande visas separat.
- Kundofferten ar inte UE-forfragan eller intern kalkyl. Import av arbeten kopierar
  bara rubrik och omfattning, aldrig inkopspriser, marginaler eller UE-svar.
- Denna forsta avtalsmodell ar avsedd for referensfallet privatkund/tillbyggnad.
  ABS 18 kan valjas tillsammans med en manuellt granskad PDF-avtalshandling.
  Ingen avtalsmall, konsumentrattslig kontroll eller juridisk garanti genereras.

## Anvandarresa

1. Intern anvandare oppnar Uppdrag > Atgardsarenden > projekt > Kundvy och offert.
2. Ange rubrik, kundens grundpris och giltighet. Hamta arbeten fran projektet eller
   lagg till dem manuellt. Markera grundatagande, tillval eller utanfor atagandet.
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
