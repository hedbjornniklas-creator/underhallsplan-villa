# Gizmo: bestallarens projektoversikt och kundoffert

Status: implementerat forsta steg for kundoversikt och versionerade kundofferter.
Datum: 2026-10-01.

## Beslut och omfattning

- Bestallaren far fem sidor: Avtal, Val och tillval, Betalningsplan, Tidsplan, Bilder och filer.
  Avtal ar forstavy; oversiktsgenvagen Mitt uppdrag har tagits bort.
  Den interna arbetsytan och UE-portalen
  behalls separat. Gemensamma data ateranvands, inte gemensamma behorigheter.
- Forsta leveransen ar offert, omfattning/tillval och delade bilder/dokument.
  Grafer for fakturering och tidplan byggs nar dessa har verkliga datakallor.
  Saknade belopp eller datum visas inte som noll eller som fiktiva framsteg.
- Kundpriser anges inklusive moms. Grundatagandet kan ha ett fast klumpsummepris
  eller fasta delpriser som summeras automatiskt. Befintliga offerter behaller
  klumpsumma; inget gammalt pris fordelas automatiskt. Saknade delpriser ar inte
  noll och blockerar publicering, men ofullstandiga utkast kan sparas.
- Nya grundavtal innehaller endast grundatagande och relevanta avgransningar.
  Fonsteralternativ och andra val ligger separat och kravs inte vid godkannandet.
  Val kan forberedas och delas fore avtalet, men ar da planering, inte bestallning.
  Separata bindande tillvals-/ATA-bestallningar aterstar. Inget nytt totalpris
  skapas genom att visa ett val i planeringen.
- Tidigare publicerade versioner behaller sin ursprungliga omfattning och sina
  valregler. De far inte tolkas om i efterhand. Nya publiceringar med val i
  grundavtalet stoppas bade i API och databastrigger.
- Kundofferten ar inte UE-forfragan eller intern kalkyl. Import av arbeten kopierar
  bara rubrik och omfattning, aldrig inkopspriser, marginaler eller UE-svar.
- Denna forsta avtalsmodell ar avsedd for referensfallet privatkund/tillbyggnad.
  ABS 18 kan valjas tillsammans med en manuellt granskad PDF-avtalshandling.
  Ingen avtalsmall, konsumentrattslig kontroll eller juridisk garanti genereras.

## Anvandarresa

1. Intern anvandare oppnar Uppdrag > Atgardsarenden > projekt > Kundvy och offert.
2. Ange rubrik, prismodell och giltighet. Hamta arbeten fran projektet eller
   lagg till dem manuellt. Markera grundatagande eller relevant avgransning.
   Ange grundpris eller delpriser. Val och tillval har en separat redigerare
   med alternativgrupp, prisunderlag och privata kalkyler.
3. Komplettera tider, betalningsvillkor, villkor och utvalda bilagor. En PDF bland
   bilagorna maste utses till avtalshandling nar ABS 18 valts.
4. Spara utkast och granska offertutkastet. Kundens startsida visar bara det som
   redan publicerats. Osparade andringar varnas vid navigation bort fran sidan.
5. Bekrafta granskning och skicka. Servern fryser offertversion och kopior av
   bilagor innan mejlet skickas. En ny version ersatter tidigare publicerad version.
6. Bestallaren oppnar Avtal och granskar grundatagande, pris, villkor och bilagor.
   Inga nya fonsterval eller tillval bestalls i detta moment.
7. En engangskod skickas till den e-postadress som frystes med offerten. Godkannande
   binder exakt version och namn. Totalen beraknas pa servern. For historiska
   versioner binds aven de val som ingick i den ursprungliga versionen.
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
  Dessa valregler bevaras for historiska dokument. Nya publiceringar far inte
  innehalla optionala poster alls.

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

### Betalningsplan (2026-10-01)

- Egen flik internt och hos bestallaren. Rubrik, belopp inklusive moms och villkor
  for fakturering per delbetalning. Planerat faktureringsdatum ar valfritt och ar
  inte ett forfallodatum eller ett intyg om utfort arbete.
- Grundavtalets befintliga `paymentTerms` redigeras i denna flik. Inga nya
  betalningsvillkor, procentsatser eller forfallotider fylls i automatiskt.
- Planen ar valfri for bakatkompatibilitet. Aktivering lagger `paymentPlan`
  (version 1, hogst 60 delbetalningar) i befintlig offertbody. Inga nya tabeller.
  Saknade belopp kan sparas i utkast; vid utskick kravs positiva hela orebelopp,
  rubriker och faktureringsvillkor. Summan maste exakt motsvara grundpriset.
  Val/tillval/ATA blandas inte in. Prisandringar skriver inte om delbetalningarna.
- Delbetalningar kan flyttas, tas bort med angring och fyllas med aterstaende
  belopp. Borttagning av hela planen bekraftas och sparas som explicit null.
- Plan och betalningsvillkor delar grundavtalets revision och sparning. Utkast
  ar privata. Kundfliken laser endast den godkanda versionen, annars den senaste
  fortfarande publicerade versionen. Ingen aterkallad plan presenteras som aktiv.
- Planen ingar i avtalsgranskning, utskrift och det befintliga godkannandet.
  Utgiven snapshot ar oforanderlig. Efter godkannande visas den last aven internt;
  en ny plan kan inte laggas pa eller skrivas over i ett redan godkant avtal.
  Separat overenskommelse om senare planandringar aterstar, liksom ATA-flodet.
- Inga fakturor, betalningar, fakturerat/betalt-statusar eller betalningspaminelser
  skapas. Dessa kravs fran en framtida faktisk fakturakalla.
- Kor `docs/db/2026-10-01_03_customer_payment_plan.sql` fore apppublicering.
  Omkorbara validators/triggers; inga befintliga projekt skrivs om. Sparning och
  publicering med den nya strukturen stoppas om databasskydd saknas. Aldre
  klienter far inte tyst ta bort faltet efter att det anvants. Org-/revisionsskydd,
  frysta versioner och mottagarkontroll ateranvands fran kundofferten.
- Lokal testdemo: lagg till `--payment-plan` till previewkommandot for tre
  uttryckligen fiktiva delbetalningar. Inga belopp laggs in i riktiga projekt.

### Separat avtal och val (2026-10-01)

- Kor `docs/db/2026-10-01_02_customer_contract_choices.sql` fore apppublicering.
  Migrationen ar omkorbar och skriver inte om nagra projekt eller avtal.
- Befintliga utkast med val far en uttrycklig flyttknapp. Flytten laser projekt,
  utkastrevision och planeringsrevision i samma transaktion. ID, ordning,
  omfattning, alternativgrupper, belopp i ore och privata kalkyler bevaras.
  Grundpriset andras inte. Delade planeringskopior andras inte och inga mejl skickas.
  Om en rad krockar eller planeringen inte kan sparas aterstalls hela flytten.
- En oppen publicerad offert maste aterkallas fore flytt; accepterade avtal kan
  inte flyttas. Kontrollera manuellt inledning, avgransningar och bilagor efter
  flytten. Fri avtalstext skrivs inte om automatiskt.
- Valens kalkyler lagras i planeringens privata `internal_costing`, aldrig i
  delad JSON. Prisunderlag ar fortfarande inte en bestallning. Redigeraren kan
  anvandas efter grundavtalets godkannande utan att det godkanda avtalet andras.
- Kundens tidsplan visar verklig avtalstext fran godkand version, annars senaste
  utgivna version markerad som foreslagen. Delade beslutsdatum visas separat.
  Ingen graf, fardiggrad eller fiktiv milstolpe skapas.
- Saknas den nya kolumnen fungerar gammal planering utan kalkyl. Flytt och
  kalkylsparning misslyckas tydligt om migrationen saknas; ingen tyst dataforlust.

### Avtalsuppgifter och separat planering (infort 2026-09-29)

- Grundatagande och avgransningar har egna vyer i
  offertredigeringen. Ett avgransningsfalt ska beskriva relevanta forvantningar,
  diskuterade arbeten eller ansvar som annars kan vara oklart, inte en lista
  over alla arbeten som inte ingar. Ingen juridisk friskrivning fylls i automatiskt.
- Exempel: malning som diskuterats men skjutits upp kan beskrivas kort under
  avgransningar och planeras separat. Den ska inte vara ett bestallningsbart
  offerttillval innan pris och omfattning ar overenskomna. Inga befintliga
  projektrader flyttas eller omklassificeras automatiskt.
- Avraden registreras aktivt: ej kontrollerad, ingen avraden lamnad eller
  avraden lamnad. I sista fallet dokumenteras arbete, skal/konsekvenser, datum
  och bestallarens besked. Beskedet innebar ingen automatisk ansvarsfrihet.
- Kompletterande avtalsfalt omfattar parter, fastighet, handlingar/rangordning,
  kontroll, arbetsmiljo, bestallarens arbeten, ATA-prissattning, forsening,
  besiktning, forsakringar, fardigstallandeskydd och sakerheter. Dessa kan
  beskrivas, hanvisas till i en identifierad avtalshandling eller markeras som
  ej aktuella med skal. Systemet avgor inte den juridiska tillampligheten.
- Nya utkast far falten. Befintliga utkast kompletteras genom ett aktivt val;
  signerade snapshots andras aldrig. Nar falten aktiverats kan de inte tappas
  bort av en aldre klient. Ofullstandiga uppgifter kan sparas men inte publiceras.
  Detta ar kompletterande uppgifter, inte en omarbetning av ABS18-standardformularet.
- Planerade tillval har egen tabell, revision och sparning, oberoende av
  huvudavtalets lasning. Intern sparning andrar inte kundens vy. Ett separat,
  bekraftat publiceringssteg delar en kopia med projektets bestallare, utan mejl.
  Kopian kan doljas igen. UE ser inte denna planering genom sin portal.
- En eventuell planeringsbudget ar inte ett bestallningsbart pris och ingar
  aldrig i offertens totalsumma. Kunden kan inte godkanna planerade poster.
  Etiketten ersatter inte behovet att bedoma prisuppgifters avtalsrattsliga betydelse.
- Kundens nya vy heter `Val och tillval`. Alla nya val skiljs fran
  huvudavtalet. Separata ATA med
  pris-/tidskonsekvens och eget godkannande aterstar fortfarande.
- Kor `docs/db/2026-09-29_04_customer_offer_planning.sql` fore apppublicering.
  Den ar transaktionell och omkorbar, med inga omskrivningar av befintliga avtal.
  Saknas migrationen avaktiveras planering och nya avtalsfalt kan inte sparas
  utan databasskydd. Tidigare offertformat fungerar fortsatt.

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

Kontroll av avtalsuppgifter/planering 2026-09-29: 148 action-case-tester passerar,
inklusive 32 offert-/planeringstester med servermock och riktiga SQL-migrationer
i PGlite. Typkontroll och riktad ESLint passerar. Manuell klickkontroll med
riktiga komponenter och fiktiv HTTP-backend omfattar intern sparning, separat
kunddelning, oforandrad grundsumma, angring av borttagning, avtalsreferenser efter
omladdning, ofullstandig avraden och mobilbredd 390 px. Inga riktiga kunddata,
mejl eller godkannanden anvandes. Vid publiceringskontrollen verifierades att
produktionens planeringstabell och bada nya RPC-funktioner finns. Anonym
tabellatkomst nekas. Ingen migration behovde koras eller kunddata andras i
samband med apppubliceringen.

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
  Valen ligger nu separat fran grundavtalet. `--legacy-draft` behaller dem i
  ett opublicerat gammalt utkast sa att den uttryckliga flytten kan klicktestas.

Verifiering 2026-10-01: CUA-klicktest i fiktiv lokal miljo av flytt, separat
fonsterkalkyl (10 procent + montage), sparning, uttrycklig delning, grundavtalsvy,
fyra kundvyer och godkannande utan val. Fel kod och nytt forsok fungerade;
grundbeloppet var oforandrat. Mobilvyer 390 och 344 px utan horisontellt overflow.
Databastest kor den nya migrationen tva ganger och verifierar atomisk rollback,
revisions-/orgskydd, privata kostnader och bevarade historiska godkannanden.
Inga riktiga mejl, avtal eller produktionsdata andrades vid dessa tester.

Verifiering av betalningsplan 2026-10-01: 165 action-case-tester passerar,
varav 49 offerttester. Typkontroll och riktad ESLint passerar. PGlite kor
betalningsplansmigrationen tva ganger och testar beloppssummor, ofullstandiga
utkast, publiceringssparrar, versions-/organisationsskydd och explicit borttagning.
CUA-klicktest med riktiga komponenter och fiktiv HTTP-backend omfattar decimalbelopp,
aterstaende belopp, omordning, borttagning/angra, aterlasning, publicering och
simulerat kundgodkannande. Sparning andrade inte kundens redan publicerade plan;
godkannande laste planen i bada vyerna. Kundvyn provades vid 390 och 344 px och
redigeraren vid 344 px utan sidledsoverflow eller overlappande falt. Inga riktiga
mejl, avtal eller produktionsdata andrades i klicktestet.
Lokal demo: `scripts/test-customer-offer-ui.mjs --serve --payment-plan`.

Publiceringsforberedelse 2026-10-01: betalningsplansmigrationen kord i produktion.
Lasande efterkontroll bekraftar att validatorn och bada triggers ar aktiva,
service_role har korbehorighet och anon/authenticated saknar direkt korbehorighet.
Inga befintliga kundavtal eller betalningsuppgifter skrevs om. Alla 165 tester
och typkontroll passerar efter uppdatering mot senaste huvudgrenen.

## Beslutslogg

- 2026-10-01: Anvandaren bestaller en egen flik for betalningsplan, bade internt
  och for bestallaren. Forsta leveransen ar en plan inom grundavtalets version,
  inte en fakturamodul eller separat signering av planandringar.

- 2026-10-01: Anvandaren faststaller att grundavtalet ska godkannas for sig,
  utan val av fonsterleverantor. Val och tillval hanteras separat efter detta
  moment men kan forberedas innan. Fyra kundsidor ersatter Mitt uppdrag och
  dubblerad omfattningsvy. Beslutet ersatter val-vid-godkannande for nya avtal,
  inte for historiska publicerade dokument.

- 2026-09-29: Utokat grundpriset med frivilligt delprislage och tillval med
  hogst-ett-val-grupper for referensprojektets behov. Tidigare versioners
  klumpsummor och godkannanden behalls oforandrade. El som inte projekterats och
  senare malning bestalls inte genom att anges som undantag; en senare ATA
  kraver ett separat flode. Verkliga delpriser maste anges av anvandaren.

## Senare steg, inte implementerade

- Fakturor med tydlig skillnad mellan avtalat, fakturerat och betalt.
  Avtalad totalsumma inkluderar bara accepterade tillval/ATA, inte valfria forslag.
- Delad tidplan med milstolpar, beroenden och bara kundpublicerade datum.
- ATA och kompletterande tillval som egna godkannanden, aldrig overskrivning av
  grundavtalet. Flera bestallare/signatarer, foretagskund, flera momssatser och ROT.
- Fardig genererad avtals-PDF, automatisk godkannandekopia via mejl, kundkonton och
  starkare signering. Nu finns kvittensen i kundvyn och webblasaren kan skriva ut.
- AI-stod for offerter och fullstandighetskontroll. Inga AI-priser eller avtalsvillkor
  publiceras automatiskt i denna version.
