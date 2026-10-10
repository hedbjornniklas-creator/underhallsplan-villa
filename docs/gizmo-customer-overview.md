# Gizmo: bestallarens projektoversikt och kundoffert

Status: implementerat forsta steg for kundoversikt och versionerade kundofferter.
Datum: 2026-10-07.

## Sektionsbyte utan scrollhopp 2026-10-07

- Offert-, avtals-, tillvals- och betalningsplansrader anvander samma
  `ProjectEditorRow`. Nar en ny rad oppnas kan en tidigare rad stangas ovanfor
  den; den klickade rubrikens skarmposition bevaras fore nasta rendering.
- Om rubriken ligger nara nederkanten flyttas den bara sa mycket som behovs for
  att borjan av formularet ska synas. Samma beteende galler tangentbordsklick.
- Webblasaren far inte samtidigt flytta scrollankaret inom denna editor.
  Regeln ar lokal; inga globala scrollregler, autofokus pa inmatningsfalt,
  sparningsandringar eller avtals-/kunddataandringar laggs till.
- Montering, autospar och programmatisk aterstallning av en rad scrollar inte;
  korrigeringen gors enbart efter att anvandaren har aktiverat just rubriken.

Verifierat lokalt med sex fokuserade regressionstester och hela action-case-
testsviten. CUA provar vanliga musklick, tangentbord, oppning/stangning,
Bestallare till Entreprenor, Offert, tillval och byte mellan delbetalningar.
Pa dator stannade rubriken vid cirka 398 px efter klick vid 401 px; pa mobil
390 x 844 px stannade den vid 519 px med forsta faltet inom skarmen.
Testbackenden registrerade inga skrivningar. Korrigeringen ingar i detta
publiceringspaket; driftstatus verifieras efter leverans.

## Beslut 2026-10-07: avtalsparter och fakturakund ar olika roller

- Avtal samlar bestallare, entreprenor och ovriga avtalsuppgifter. Att fylla i
  namn eller autospara skapar ingen registerkund. Kundregistervalet tas bort
  fran Avtal; detta ersatter UI-beslutet om bestallare-1-koppling 2026-10-06.
- Internt byter Betalningsplan namn till Betalning och fakturering, med
  registerflikarna Betalningsplan och Fakturakund. Bestallarens publika
  betalningssida behaller namnet Betalningsplan och far inte interna kunddata.
- Betalningsvillkor och delbetalningar redigeras pa ett stalle och ingar i
  samma frysta avtalsversion som pris och omfattning. Godkand plan ar last;
  senare andring kraver separat overenskommelse, inte redigering av historiken.
- Fakturakund valjs ur HusHubs gemensamma organisationskundregister, eller
  skapas uttryckligen av en registeradministrator. Kontaktadress, separat
  fakturaadress/-mejl och referens ateranvander registrets befintliga falt.
  Kopiera bestallare 1 ar ett uttryckligt formularval, inte automatisk synkning;
  personnummer och medbestallare kopieras inte. Registerandringar sparas
  uttryckligen eftersom de ar gemensamma for organisationen.
- Projektets privata `action_case_billing` har en egen revision och kundlank.
  Skapa kund och koppla sker atomiskt med idempotenta aterforsok. Kundens version
  kontrolleras ocksa vid koppling/redigering. Fel behaller lokal inmatning och
  visas genom gemensamma toasts; statusytan har stabil hojd. Formularutkast
  bevaras vid interna vybyten, med skydd mot att lamna osparad inmatning.
- Byte eller redigering av fakturakund andrar aldrig avtalsparter, mottagare,
  publicerade/godkanda versioner, betalningsvillkor eller delningar. Fakturakund
  ar inte automatiskt avtalspart eller ansvarig for bestallarens skyldigheter.
  Befintlig legacy-lank `action_cases.organization_customer_id` behalls for aldre
  klienter, men anvands inte som fakturakoppling och backfillas inte automatiskt.
- Befintlig Fortnox-kundexport ateranvands som uttrycklig handling med samma
  behorighets- och versionskontroll. Kopplad betyder kundnummer registrerat,
  inte att uppgifterna alltid ar synkroniserade. Uppdatering av redan kopplad
  kund, dubbelriktad synkning, fakturor och betalstatus ar inte byggda i detta steg.
- Ny migration: `docs/db/2026-10-07_01_action_case_billing.sql`. Fore aktivering
  av produktion behovs denna migration. Ovriga projektvyer fungerar utan den;
  fakturakoppling visas som ej aktiverad. Inga riktiga registerkunder, fakturor,
  mejl eller godkannanden skapas av den lokala testdemonstrationen.

Lokal demo: `scripts/test-customer-offer-ui.mjs --serve --project-billing --payment-plan`.

Verifierat lokalt: 262 action-case-tester samt 14 tester for gemensam
kundvalidering och Fortnox-export. Typkontroll, riktad ESLint och webpack-
produktionsbygge passerar. PGlite provar migrationen tva ganger, roller/tenant,
kund- och projektrevisioner, atomiska aterforsok utan dubletter och oforandrat
godkant avtal, mottagare, betalningsplan och delningar. CUA-klicktest med
fiktiv backend provar separat fakturakund, kopiering, tomt namn, separat
fakturamejl, sparfel/nytt forsok, langsamt sparande, interna vybyten,
aterlasning och fakturaredigering efter avtalsgodkannande. Mobil 390 px har
ingen horisontell sidooverflow och bada betalningsflikarna ryms.
Ingen riktig Fortnox-export, faktura, mejl eller signering genomfordes.
Publiceringskontroll 2026-10-07: anvandaren har kort migrationen i produktion.
Serverkontroll verifierar tabellen och RPC-funktionen med ett ogiltigt anrop
som avvisas fore nagon skrivning. Anonym tabell- och funktionsatkomst nekas.
Inga riktiga kunder, fakturor, mejl eller avtalsversioner andrades av kontrollen.

## Beslut 2026-10-06: separata arbetsvyer for Offert och Avtal

- Offert samlar rubrik, giltighet, omfattning och kundpris. Avtal borjar med
  Bestallare och Entreprenor, foljt av ovriga medverkande och ABS 18-uppgifter.
  Samma omfattning och pris ateranvands; avtalet kraver ingen andra inmatning.
- Arbetsvyerna delar befintlig utkastrevision. Vybyte varken skickar eller sparar
  och bevarar pagaende redigering. Granska offert visar omfattning och pris;
  Granska avtal visar aven avtalsuppgifter och betalningsplan.
- Bestallaren har namn och valfritt personnummer for hogst tva personer samt
  gata/box, postnummer, ort, telefon, mobil och e-post. Entreprenoren har firma,
  organisationsnummer, kontaktperson, mobil, adress, telefon, fax och e-post.
  F-skatt anges uttryckligen, aldrig genom ett antagande.
- Entreprenorens namn, organisationsnummer och adress hamtas fran den aktiva
  organisationens foretagsprofil. Kontaktpersonens namn, mobil och e-post hamtas
  fran den inloggade profilen. Redan sparade avtalsuppgifter behalls. Knappen
  Hamta foretagsuppgifter aterhamtar de profiluppgifter som sidan laddade.
- Uppgifterna sparas under `contractParties` i befintlig utkast-JSON och fryses
  med avtalsversionen. Inga nya tabeller eller SQL-migrationer behovs. Personnummer
  bevaras internt men utelamnas fran den publika bearer-lankens JSON och dokument.
- Utskick ligger enbart under Avtal och anvander befintligt versions- och
  kodflode. Detta steg skapar inte ett separat utskick/godkannande av prisofferten.
  Nuvarande godkannande verifierar en brevlada. Tva bestallare kan forberedas och
  sparas, men utskick blockeras tills bada kan signera separat.
- Anvandaren har bekraftat att inga dokument har skickats och att projektet ar
  i utvecklingsstadiet. Aldre implementeringsavsnitt nedan beskriver tidigare steg;
  denna uppdelning ersatter deras gemensamma interna sida Offert och avtal.

Verifierat lokalt: 233 action-case-tester, TypeScript, riktad ESLint och
produktionsbygge med webpack. Klicktester med fiktiva data verifierar separata
granskningar, profilhamtning utan att skriva over F-skatt, tillagg/borttagning av
bestallare, bevarade andringar vid vybyte, sparfel/nytt forsok och aterlasning.
Mobilformular pa 390 px har ingen horisontell sid-overflow. Inga riktiga utskick
eller godkannanden genomfordes.

## Beslut 2026-10-06: fran Projektarbete till avtalsutkast

Det tidigare beslutet om jamforelse per falt och obligatorisk granskning av
andrat underlag ersatts av foljande uttryckliga anvandarbeslut 2026-10-07:

- Hamta fran projektdata oppnar en kompakt krysslista under Arbetsdelar och
  avgransningar. Valj alla eller enskilda arbetsdelar och Hamta och ersatt.
- Valda raders rubrik, omfattning, forutsattningar, undantag och avradan ersatts
  i samma utkast. Ovriga rader bevaras. Tomma tillgangliga kallfalt tommer text;
  otillgangliga kallfalt far inte radera befintliga uppgifter.
- Kundpriser bevaras som standard. I delprislage kan kontrollerade kundpriser
  hamtas uttryckligen. Saknat kontrollerat pris raderar inte befintligt pris.
  Klumpsumma, intern kalkyl, UE-underlag, valklassning och bilagor andras inte.
- Aldre inkluderade rader kopplas automatiskt endast vid ett unikt likadant namn.
  Vid olika eller tvetydiga namn valjer anvandaren vilken aldre rad som ersatts
  eller om en ny ska skapas. Ingen osaker namn- eller ordningsmatchning gors.
- Radens ID och prisreferenser bevaras; kallkoppling `items[].sourceItemId`
  sparas i befintlig utkast-JSON sa senare namnandringar inte skapar dubbletter.
  Kallkoppling och aldre `sourceReview`-historik utelamnas i publik projektion.
- Import i Avtal autosparas i befintlig ko. Besok eller andringar i Projektarbete
  skriver inte automatiskt over avtalet. Jamforelse, faltval och Behall tas bort;
  andrat underlag ar inte langre en separat utskickssparr.
- Osparat Projektarbete, last avtal och pagaende skrivningar skyddas fortsatt.
  Publicerade versioner, revisionskontroll och organisationsskydd andras inte.
  Inga nya tabeller eller SQL-migrationer. Versionspaket for publicering 2026-10-08;
  driftsattning kontrolleras separat. Befintliga projekts avtalsrader andras inte
  av publiceringen, inklusive eventuella redan skapade dubbletter.

Verifiering av den forenklade importen: 338 action-case-tester, TypeScript,
riktad ESLint och produktionsbygge passerar. Lokal klickkontroll med riktiga
komponenter och fiktiva data verifierar val av en respektive alla arbetsdelar,
bevarad ovald text och kundpris, exakt aldre namnkoppling, uttrycklig koppling
vid annat namn, autosparning, omladdning utan dubbletter samt sparfel/aterforsok.
Krysslistan ar visuellt kontrollerad pa dator. Inga riktiga projekt, avtalsversioner
eller kundutskick andrades. Smal viewport kunde inte verifieras eftersom
webblasaren beholl sin datorbredd trots begard viewportinstallning.

## Beslut 2026-10-06: redigeringsordning enligt ABS 18

Redigeringssidan ordnas efter entreprenadkontraktet som hor till ABS 18, inte
efter paragrafordningen i de allmanna bestammelserna. Originalet har kontrollerats
2026-10-06: [Entreprenadkontrakt ABS 18, 2018.06](https://byggtjanstcms.byggtjanst.se/globalassets/pdf/entreprenadkontrakt-abs-18.pdf).

- Offertuppgifter (Gizmos rubrik, avtalsgrund och giltighet), parter och ovriga
  medverkande, fastigheten, uppdraget, handlingar och bestallarens arbeten.
- Arbetsmiljo, avradande, pris, andringar/tillaggsarbeten, betalning och tider.
- Forsening/vite, besiktning, forsakringar/sakerhet och ovriga villkor.

Befintliga avtalsfalt och betalningsplan ateranvands. Inga standardvillkor,
ansvarsfordelningar eller godkannanden fylls i automatiskt. Detta ar en
ordning for avtalsberedning, inte en andrad ABS-blankett eller en garanti om
ett juridiskt fullstandigt kontrakt. Kravet pa separat granskad PDF-avtalshandling
vid ABS 18 kvarstar. Endast fasta kundpriser stods fortsatt av prismodellen.

Lokal kontroll: 227 action-case-tester, TypeScript, riktad ESLint och
produktionsbygge passerar. Klicktest med fiktiva data pa dator och mobil
verifierar selektiv import, bevarad egen avtalstext, andrat projektunderlag,
val per falt samt sparning och aterlasning av granskningsbeslut. Simulerat
sparfel bevarar andringarna och tillater nytt forsok. Avbrutet byte av
prismodell bevarar klumpsumman. Avtalsfalt och betalningsnavigation fungerar;
kundens publicerade version forblir oforandrad.

## Beslut 2026-10-05: omfattning och borttagning

- Varje atgard har tva valfria falt direkt under Arbetets omfattning:
  Ingar inte och Avradan (hogst 6 000 tecken vardera). Samma sparning,
  organisationskontroll och versionskontroll som omfattningen ateranvands.
- Vid uttrycklig import till offertutkastet kopieras dessa texter. For en redan
  importerad arbetsdel kan anvandaren uttryckligen ersatta de tva falten;
  kundens redigerade rubrik, omfattning och pris behalls. Skickade/godkanda
  versioner skrivs aldrig om. Tomma falt ger inga tomma rubriker i avtalet.
- En skriven avradan innebar inte att den framforts eller accepterats.
  Befintlig dokumentation av avradan i Avtalsuppgifter kravs fore utskick nar
  en arbetsdel innehaller avradan. AI-kalkylen far bada falten som kallunderlag.
- Papperskorgen i atgardens sidofonster kraver bekraftelse. Radering tar bort
  atgard och intern kalkyl men bevarar projektfiler och handelsehistorik.
  Aktuell version kravs. Offererade/paborjade atgarder och kopplingar till
  UE-underlag, kundoffertutkast, skickade avtal eller tidsplan blockerar radering.
  Oskickade kopplingar maste hanteras dar de skapades; skickade underlag bevaras.
- Databaskrav: `2026-10-05_01_action_case_scope_notes.sql` och
  `2026-10-05_02_action_case_item_deletion.sql`, efter befintliga offert- och
  tidsplansmigrationer. Bada ar aterkorbara. De aktiveras separat vid release.
  Aldre klienter far inte tyst tappa de nya offertfalten. Radering anvander en
  transaktionell service-role-RPC efter befintlig org- och modulbehorighet.

## Beslut och omfattning

- Interna namn: Projektarbete (omfattning, kalkyl och UE), Offert och avtal
  (kundpriser, villkor och betalningsplan) och Visa som bestallare (forhandsgranskning).
  Forhandsgranskningen ar tydligt markerad och visar bara delat/publicerat innehall,
  inte det interna avtalsutkastet. Att oppna vyerna sparar eller skickar ingenting.
- Gemensam projektnavigering samlar de interna arbetsytorna under /uppdrag/[caseId].
  Projektlistan finns pa /uppdrag. Aldre /kund-adresser leder till Offert och avtal.
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
- Kundofferten ar inte UE-forfragan eller intern kalkyl. Import kopierar rubrik
  och omfattning. I delprislage kan anvandaren uttryckligen ta med kontrollerade
  kundpriser inklusive moms. Inkopspriser, marginaler och UE-svar kopieras aldrig.
- Denna forsta avtalsmodell ar avsedd for referensfallet privatkund/tillbyggnad.
  ABS 18 kan valjas tillsammans med en manuellt granskad PDF-avtalshandling.
  Ingen avtalsmall, konsumentrattslig kontroll eller juridisk garanti genereras.

## Anvandarresa

1. Intern anvandare oppnar Uppdrag > projekt > Offert och avtal.
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

## Intern priskalkyl i Offert (2026-09-29)

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

### Kompakta redigerare och manuell tidsplan (2026-10-01)

- Offertens delar, val/tillval och delbetalningar visas som kompakta rader.
  Klick oppnar en rad; nya rader oppnas direkt. Utkast bevaras vid ihopfallning
  och interna vybyten. Sen inmatning skrivs inte over av ett pagaende sparforsok.
- Moment i tidsplanen har fri projektdel, start/slut och manuellt vald status.
  Import fran projektarbete ar valbar och skapar inte dubbletter. Det finns
  inga beroenden, automatisk datumflytt eller beraknade fardigprocent.
- Interna och delade rader lagras separat, med organisationskontroll och revision.
  Bestallaren ser bara uttryckligen delad kopia. UE ser inte denna plan via sin
  portal. Delningen skriver aldrig om avtalets tider eller accepterade version.
- Samlat pris anges pa atgarden som kundpris och valfri intern kostnad exklusive
  moms. Detaljkalkylen finns kvar men adderas inte till totalen. Endast uttryckligen
  kontrollerat kundpris kan importeras till offert, med moms. Inga tidigare
  kalkyler eller offerter omvandlas automatiskt.
- Bilder anvander befintlig privat filatkomst och miniatyrvisning. Bildformat
  identifieras aven fran MIME/filnamn for aldre bilagor. Inga delningsrattigheter
  utvidgas genom att en miniatyr visas.
- Kor `docs/db/2026-10-01_04_action_case_schedule.sql` och
  `docs/db/2026-10-01_05_action_case_lump_sum.sql` fore aktivering i produktion.
  De ar omkorbara och andrar inga befintliga avtalsversioner. Utan migrationerna
  ar ny tidsplansredigering respektive samlat pris inte aktiva.

Publiceringskontroll 2026-10-01: migrationerna 04 och 05 korda i produktion.
Tabell, kolumn, validerad priskontroll, RLS och service-rollens RPC verifierade.
Direkt klientatkomst till tidsplanen nekas. Befintliga avtal ar inte omskrivna.

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

- 2026-10-06: Redigering i Avtal autosparas efter 700 ms skrivpaus med samma
  `useAutosaveQueue` som Projektarbete. En skrivning at gangen, senast kvitterad
  utkastrevision och nyare lokal text behalls. Kon lever vidare vid interna
  flikbyten. Ingen automatisk skrivning vid oppning av ett gammalt utkast.
  Sparstatus har fast hojd och bredd; lyckad autosparning ger ingen toast.
  Fel ger gemensam feltoast och uttryckligt nytt forsok, utan automatisk
  overskrivning av en annan sessions revision. Osparad text behalls i den oppna
  vyn och sidlamning varnas; detta ar inte en bestandig offlineko.
  Autospar uppdaterar endast internt utkast och dess interna priskalkyl via
  befintliga RPC:er. Kundregister, mottagare, delningar, skickade avtalsversioner
  och mejl berors inte. Andrat mottagarnamn, e-post eller telefon bekraftas med
  Bekrafta mottagare; utskick ar blockerat tills uppgifterna ar bekraftade.
  Kundkoppling, granskning och utskick ar fortfarande uttryckliga handlingar.
  Offert, separat tillvalsplanering och betalningsplan behaller sina manuella
  sparhandlingar. Ingen ny databasmigrering behovs.

- Verifiering 2026-10-06 av kundkoppling: 246 action-case-tester, 15 gemensamma
  kundregistertester och 47 tester for uppdragskund/TU passerar. Riktad ESLint
  och typkontroll passerar. PGlite provar migrationen tva ganger, atomiska
  skrivningar, dublettskydd, tenant-/roll-/revisionsskydd och aterkallade
  delningar. CUA-klicktest med fiktiv lokal backend provar befintlig/ny kund,
  medbestallare, mottagarbyte, sparfel/aterforsok, omladdning, filvy och
  bevarad intern men aterkallad delad tidsplan. Mobil 390 px utan
  sidledsoverflow. Inga riktiga kunddata, mejl eller avtal andrades.
  Migrationen ar inte kord i produktion i detta utvecklingssteg.

- 2026-10-06: Bestallare i Avtal ska anvanda HusHubs gemensamma kundregister,
  inte ett separat Gizmo-register. TU:s uttryckliga val/skapa och idempotenta
  kundkoppling ar forlagan. Befintlig privatkund hamtas genom samma API som
  Installningar; kundnummer, organisation och validering ateranvands. OB/EB
  har inte denna registerkoppling i den granskade koden. Forsta leveransen
  kopplar bestallare 1; en medbestallare bevaras som avtalsuppgift, inte som
  ytterligare registrerad kund eller sjalvstandig signatar.
  Att skriva ett namn skapar ingen kund. Anvandaren valjer uttryckligen Hamta
  och koppla kund eller Skapa och koppla kund. Skapande kraver samma
  kundregisterbehorighet som Installningar; lasare kan valja men far inte
  hamta kundregistrets personnummer. TU:s bredare skaparbehorighet andras inte.
  Ny kund, projektmottagare och avtalsutkast sparas i en transaktion med
  revisionskontroll och aterforsoksskydd. Vanliga avtalsandringar uppdaterar
  mottagaren efter sparning, aldrig kundregistret eller andra uppdrag.
  Byte av bestallare aterkallar gamla kundlankar/fildelningar och rensar
  delad planering/tidsplan, men behaller internt underlag. Projekt med
  publicerade avtalsversioner tillater inte kundbyte: gamla dokument ska inte
  kunna arvas av en annan person. Accepterade avtal forblir lasta.
  Registerkoppling finns inte automatiskt for gamla projekt; ingen namn- eller
  e-postmatchning kor som backfill. Ny migration:
  `docs/db/2026-10-06_01_action_case_organization_customer.sql`.
  Lokal kunddemo: `scripts/test-customer-offer-ui.mjs --serve --customer-registry`.

- 2026-10-06: Valfria Forutsattningar laggs mellan Arbetets omfattning och
  Ingar inte. Eget textfalt med samma bakgrundssparning, versionskontroll och
  6000-teckengrans som ovriga omfattningsnoteringar. Foljer med vid uttrycklig
  hamtning till offertutkast och som kallunderlag i AI-kalkylen, aldrig som
  systeminstruktion. Andring kraver ny kontroll av samlat pris. Publicerade och
  accepterade avtal skrivs inte om. Migration:
  `docs/db/2026-10-06_01_action_case_scope_conditions.sql`.

- 2026-10-06: Omfattning och Kalkyl visas som registerflikar i atgardens
  sidofonster. Den dubblerade knappen Ga till kalkyl tas bort. Klick pa bakgrunden,
  kryss och Escape anvander samma stangningskontroll. Sparning av omfattning
  fortsatter i projektarbetsytan efter stangning; osparade kalkylpriser kraver
  fortfarande bekraftelse och pagaende kalkylmutationer blockerar stangning.
  Musdrag som borjar inne i fonstret stanger det inte vid slapp utanfor.

- 2026-10-05: Omfattning i atgardens sidofonster sparas automatiskt efter
  700 ms skrivpaus med befintliga `useAutosaveQueue`. Rubrik, omfattning,
  avgransningar, avradan och filval ingar. Kon ags av projektarbetsytan sa
  sidofonstret kan stangas eller byta atgard utan att avbryta sparningen.
  Ga till kalkyl oppnar direkt; mutationer som behover den sparade omfattningen
  invantar sparningen. Kalkylpriser sparas fortfarande uttryckligen.
  Nyare text behalls under pagaende anrop, varje nasta skrivning anvander senast
  bekraftade version. Sparfel visas med gemensam toast samt status och nytt forsok.
  Utkast finns kvar i den oppna projektvyn, med varning vid sidlamning; detta ar
  inte en beständig offlineko och utkast overlever inte att webblasaren avslutas.
  Sparsvaret ar begransat till atgarden. Atgarder med offertpriser anvander
  befintlig lasmodell for att kontrollera offerten mot andrad omfattning.
  Inget kundavtal eller publicerat offertunderlag uppdateras automatiskt.

- 2026-10-01: Gemensam projektnavigering är nu beställd. /uppdrag blir en
  projektlista med Aktuellt och Statistik som separata vyer. /uppdrag/[caseId]
  samlar arbete, offert, val, betalningsplan och filer. Äldre /kund-länkar leds
  till Offert och avtal. Utkast bevaras vid interna vybyten, externa
  kundprojektioner och frysta dokument behåller befintliga åtkomstregler.
  Se [Gizmos profil 2.0](GIZMO_BRAND_PROFILE.md). Ingen datamigrering krävs.

- 2026-10-01: Anvandaren faststaller namnen Projektarbete, Offert och avtal och
  Visa som bestallare. Kundforhandsgranskning skiljs visuellt fran intern redigering.
  Gemensam projektnavigering ar langsiktig riktning, inte del av denna leverans.

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

## Direkta avtalsfalt 2026-10-07

- Beslut: avtalsuppgifter skrivs direkt i synliga falt utan menyn Ej kontrollerat /
  Ange uppgifter / Regleras i avtalshandling / Ej aktuellt. Verkliga val, som
  avradan och F-skatt, behalls. Kontrollansvarig enligt plan- och bygglagen och
  bestallarens kontrollant har tva separata falt under Ovriga medverkande.
- Befintlig avtals-autosparning ateranvands. Text registreras som angiven nar
  anvandaren skriver; ett tomt falt blir aldrig automatiskt ej aktuellt.
  Asterisker avser programmets utskickskrav, inte ett juridiskt krav pa att en
  person maste vara utsedd. Dar ingen ar utsedd kan detta anges uttryckligen.
- Tidigare status, hanvisning och gemensam rolltext behalls. Gemensamma uppgifter
  visas i en separat utfalldel, utan automatisk gissning om vem som har vilken
  roll. Gamla fullstandiga uppgifter tillats fortsatt enligt samma utskickskrav.
  Nya separata rolluppgifter kontrolleras var for sig fore utskick.
- Historiska prefix som Avtalshandling och Ej aktuellt visas i sjalva textfaltet.
  Vid redigering sparas den synliga texten som angiven uppgift, utan dolt prefix.
  Anvandaren kan darfor ersatta ett tidigare undantag med nya uppgifter.
- Valfritt `contractDetails.controlParticipants` lagrar rollfordelningen i
  befintlig JSON. `fields.controls` innehaller fortsatt en kompatibel samlad
  text, inklusive tidigare uppgifter. Befintlig SQL-validering och storleksgrans
  ateranvands; ingen SQL-migration eller omskrivning av sparade dokument behovs.
  Publicerade versioner utan den nya strukturen visas oforandrade.
- Regressionstester omfattar direkt inmatning, tomma falt, kompatibilitet,
  textgranser, SQL-lagring och frysta avtalsversioner. Andringen ingar i detta
  publiceringspaket; driftstatus verifieras efter leverans.
- Verifiering: 278 action-case-tester passerar, inklusive tio nya tester for
  avtalsfalten/SQL. TypeScript, riktad ESLint och produktionsbygge med webpack
  passerar. Lokala klicktester med fiktivt backend omfattar direkt inmatning,
  bakgrundssparning, omladdning, sparfel/aterforsok och avtalsforhandsgranskning.
  Desktop och mobil 390 px ar kontrollerade; inga riktiga avtal eller mejl andras.

## Borttaget gemensamt rollfalt 2026-10-07

- Anvandaren har beslutat att ta bort Tidigare gemensamma uppgifter. Detta
  ersatter den tidigare utfalldelen och undantaget for gemensamma rolluppgifter.
  Avtalsredigeringen visar bara kontrollansvarig och bestallarens kontrollant.
- Redigerbara utkast tar inte med den gamla gemensamma texten. Rollerna arvs
  bara fran redan strukturerade rollfalt; inga namn eller roller gissas fran
  tidigare fritext. De tva rollerna kontrolleras var for sig fore utskick.
- Ursprungliga sparade uppgifter och publicerade avtalsversioner skrivs inte om
  vid lasning. Andringen av utkastet sparas genom det befintliga sparflodet med
  revisionskontroll. Historiska dokument visas fortsatt med sitt ursprungliga
  innehall. Ingen SQL-migration kravs.
- Verifierat lokalt med 279 action-case-tester, TypeScript och riktad ESLint.
  Klicktest med ett aldre fiktivt utkast omfattar direkt inmatning, autosparning,
  omladdning och avtalsforhandsgranskning utan den tidigare texten. Desktop och
  mobil 390 px ar kontrollerade. Denna justering ingar i publiceringspaketet 2026-10-07.

## Gemensam fastighet och ABS 18-falt 2026-10-07

- Beslut: Fastigheten delas i kommun, fastighetsbeteckning, gata, postnummer och
  ort, enligt fastighetsdelen i [ABS 18-formularet](https://byggtjanstcms.byggtjanst.se/globalassets/pdf/entreprenadkontrakt-abs-18.pdf).
  Gammal sammanslagen text visas som referens vid komplettering, aldrig som
  gissade strukturerade uppgifter. Referensen lagras i `propertyReference` sa
  att den finns kvar efter delvis ifyllnad, autosparning och omladdning, men den
  skrivs inte ut i det nya avtalet. Byggnadsarea och uppdragsbeskrivning ar inte
  del av fastighetsidentiteten. Programmets utskickskrav galler kommun,
  beteckning, gata och ort; postnummer ar valfritt.
- Uppdrag ateranvander `public.properties`, samma register och UUID som OB,
  TU och Fuktsakerhet. `action_cases.property_id` kopplar projektet dit.
  Kommun + normaliserad beteckning identifierar kandidater. Beteckningen ensam,
  adressen eller projektnamnet anvands aldrig som unik identitet eller behorighet.
- Val fran HusHub kopierar befintliga uppgifter till utkastet. Registrera
  fastigheten skapar en post med den befintliga agarmodellen; koppling och
  avtalsutkast sparas atomiskt med revisionskontroll och identiskt aterforsok.
  En matchande tillganglig fastighet maste valjas i stallet for att skapas igen.
  Flera aldre dubletter kraver ett uttryckligt val, aldrig automatisk sammanslagning.
- Tillgangliga kandidater ar anvandarens befintliga fastigheter eller fastigheter
  redan uttryckligt kopplade till organisationens Uppdrag. Registrets befintliga
  RLS andras inte. Kopplingen ger inte atkomst till andra modulers rapporter eller
  projekt. Fastigheter utan kommun/beteckning behover kompletteras i registret.
- Avtalsutkastet har en egen strukturerad kopia i `contractDetails.property` och
  en kompatibel sammanstallning i `fields.property`. Befintlig autosparning
  ateranvands, men redigering uppdaterar inte registret automatiskt. Andrad
  kommun/beteckning tar bort projektkopplingen vid sparning och kraver nytt val
  eller registrering. Aldre klienter kan inte kasta bort strukturen.
- Skickade avtal maste aterkallas fore omkoppling; godkanda avtal kan inte
  kopplas om. Historiska avtal och besiktningssnapshots skrivs aldrig om.
  Ingen retroaktiv matchning eller omskrivning gors i OB, TU eller RenoApp.
  RenoApps sjalvstandiga arenden och atkomstprinciper ar oforandrade.
- Fastighetslistan kan nu sokas pa beteckning och kommun. Detta ar gemensam
  objektkoppling, inte ett globalt fritt register eller verifiering mot Lantmateriet.
- Migration: `docs/db/2026-10-07_02_action_case_property.sql`. Den ska koras
  fore publicering. Ingen riktig databas, kund eller avtalsversion har andrats
  under de lokala testerna. Andringen ingar i publiceringspaketet 2026-10-07.
- Verifiering: 291 action-case-tester, TypeScript, riktad ESLint och webpack-
  produktionsbygge passerar. Bygget anvander lokala testvarden for Supabase,
  inte driftens anslutning. Klicktester med fiktivt backend omfattar befintlig/
  ny fastighet, kommunskillnad, dublett, autosparning, sparfel/aterforsok,
  omladdning efter delvis komplettering och avtalsforhandsgranskning.
  Desktop och mobil 390 px ar visuellt kontrollerade utan horisontell overflow.

## Uppdraget och uppladdade avtalshandlingar 2026-10-07

- Beslut: Uppdraget samlar handlingsforteckning, kompletterande omfattning och
  undantag enligt faltstrukturen i ABS 18. Arbetsdelar fran Offert/Projektarbete
  finns kvar och behover inte skrivas pa nytt. Avtalsgrund och val av PDF flyttas
  hit; ovriga bilagor har en separat utfalldel, utan dubbla val av samma handling.
- Valj en uppladdad projektfil. Typ ar fritext med forslag, namn hamtas fran
  filnamnet och kan redigeras, datum anges uttryckligen. Uppladdningsdatum eller
  filnamn tolkas aldrig som handlingsdatum. Det finns flytt- och borttagningsverktyg.
  Borttagning galler bara avtalskopplingen, inte filen i projektbiblioteket.
- Oppna-lanken anvander befintlig skyddad filroute och separat flik, sa att
  dokument och avtalsredigering kan granskas samtidigt. Interna UE-offertdokument
  erbjuds inte i urvalet och skyddas aven i databasens nya referenskontroll.
- Valfria fritextfalt: Samt enligt foljande, Entreprenorens atagande omfattar inte
  och kompletterande uppgifter om handlingarna. Tidigare fritext om handlingar
  bevaras i det sista faltet vid forsta strukturerade redigeringen.
- `contractDetails.assignment` lagrar fil-ID, typ, namn, datum, ordning och
  kompletterande texter. Referenser och `attachmentIds` sparas i samma befintliga
  revisionsstyrda autosparning. Ofullstandiga rader far sparas men blockerar
  utskick. Handlingsforteckningen och texterna fryses i den publicerade versionen,
  tillsammans med befintliga separata filkopior. Aldre versioner skrivs inte om.
- Ingen juridisk rangordning gissas fran listordningen. Standardvillkoren ligger
  fortsatt i den valda originalhandlingen; programmet skriver inte om ABS 18.
  Referens: [Konsumentverkets entreprenadkontrakt ABS 18](https://publikationer.konsumentverket.se/produkter-och-tjanster/boende-och-hantverkstjanster/entreprenadkontrakt-abs-18).
- Migration: `docs/db/2026-10-07_03_contract_assignment_documents.sql`, kor fore
  publicering. Databasskyddet kontrollerar dokumentmetadata, projekt/organisation,
  privata dokument, bilagereferenser och frysta filkopior. Aldre klienter kan inte
  kasta bort den nya strukturen. Ingen retroaktiv migrering av utkast goras.
  Denna andring ingar i publiceringspaketet 2026-10-07.
- Verifierat: 300 action-case-tester, TypeScript, riktad ESLint och produktionsbygge.
  SQL-migrationen testas med PostgreSQL/PGlite, inklusive upprepad korning,
  privata filer, organisationsgranser och frysta publicerade referenser.
  Lokala klicktester med fiktiva uppgifter omfattar val, redigering, flytt,
  borttagning utan filradering, autosparning, omladdning och aterforsok efter sparfel.
  Desktop och mobil 390 px ar visuellt kontrollerade, inklusive avtalsutkastet.
  Oppna-lankarnas separata flik verifieras; verkliga PDF-filer och produktionsdata
  ingar inte i det syntetiska klicktestet.

## Databaskontroll infor publicering 2026-10-07

- Fastighetsmigration 02 fanns redan i produktion. Lasande SQL-kontroll visade
  att `assert_contract_assignment(jsonb,boolean)` saknades, inte bara i API-cachen.
- Migration 03 kordes med framgang i projektet `rfresrbuekidumbwzpcm`, inklusive
  `NOTIFY pgrst, 'reload schema'`. Inga befintliga avtal eller kunduppgifter
  skrevs om. API-funktionen ar tillganglig med service-roll.
- Lasande produktionskontroller accepterar korrekt dokumentmetadata och avvisar
  ogiltigt datum respektive ofullstandig publicering. Anonym funktionsatkomst nekas.
- Produktionsbygge, riktad ESLint och den uppdaterade migrationens atta
  regressionstester passerar. Hela action-case-testsviten har 300 godkanda tester.
- Driftstatus for appen verifieras separat efter push till `main`.

## En gemensam handlingslista 2026-10-07

- Beslut: Den separata valjaren Avtalshandling (PDF) tas bort fran Uppdraget.
  Alla handlingar laggs till en gang med Lagg till handling fran projektet.
  En PDF-rad kan markeras Innehaller avtalsvillkoren; bara en rad kan ha rollen.
- Befintligt `termsAttachmentId` ateranvands. Tidigare markeringar bevaras och
  byte av villkorshandling andrar inte datum, namn, typ, ordning eller bilagor.
  Borttagning fran listan tar bort rollen, inte den uppladdade projektfilen.
  Egen avtalshandling kan valja Ingen separat villkorsbilaga.
- ABS 18 kraver fortsatt vald PDF fore utskick. Saknad markering visas med en
  text som hanvisar till handlingsforteckningen, inte den borttagna valjaren.
  Befintlig autosparning och serverkontroll anvands utan ny SQL-migration.
- Status: ingar i publiceringspaketet 2026-10-07. 302 regressionstester,
  TypeScript, riktad ESLint och produktionsbygge passerar. Lokala klicktester verifierar
  markering, borttagning av roll, autosparning och omladdning. Byte mellan tva
  PDF-filer och bildfilers uteslutning fran rollen omfattas av regressionstester.
  Desktop och mobil 390 px ar visuellt kontrollerade utan horisontell overflow.

## Kompakt handlingsforteckning 2026-10-07

- Handlingslistan i Avtal foljer Gizmos beslutade variant Tydlig tabell:
  tonad rubrikrad, 60 px normalrader, tunna raka avdelare, gronbla pekning/
  fokus och dampad gul markering for oppen rad. Samma fargtokens anvands.
- Typ, namn och datum ar synliga utan att oppna redigeraren. Filikonen oppnar
  den skyddade filrouten i separat flik. En rad oppnas at gangen med klick
  eller tangentbord; ny handling oppnas direkt. Lang typ kan forkortas i
  listan men finns i tooltip och i redigeringsfaltet. Smal yta staplar metadata.
- Namn, datum, typ, villkorsroll, flytt och borttagning behaller samma datamodell
  och revisionsstyrda autosparning. Sammanfallning gor ingen separat sparning.
  Ingen SQL, kunddata eller publicerad avtalsversion andras av layouten.
- Status: ingar i publiceringspaketet. 305 action-case-tester,
  TypeScript, riktad ESLint och produktionsbygge passerar. Lokala klicktester
  med fiktivt backend omfattar tangentbordsoppning, tillagg, redigering,
  omordning, radbyte under langsamt autosparande, sparfel/aterforsok och
  omladdning. Villkorsrollen behalls. Ingen produktionsdata eller utskick andras.
- Datorns rubrikrad och normala 60 px-rader ar matta. Vald rad anvander
  profilens gula token; hover/fokus ar gronbla. Mobil 390 och 344 px kontrollerad
  utan horisontell overflow. Faltrutor anvander 16 px text och verktyg 48 px.

## Automatiska ABS 18-standardvillkor 2026-10-07

- Beslut: valet ABS 18 ska automatiskt bifoga dess allmanna bestammelser.
  Egen avtalshandling behaller det manuella PDF-valet. Den tidigare manuella
  villkorsrollen for ABS 18 ersatts av denna fasta standardbilaga.
- Originalet fran Byggforetagens officiella nedladdning lagras oforandrat som
  public/abs18-2018-06.pdf, 54 872 byte, version 2018.06. SHA-256 ar
  7959e2511754ad839b32c0a7548783804218a54271bac1a29d16ff8094b309c3.
  Kalla: https://byggforetagen.se/app/uploads/2020/01/180613-_Allmanna_bestammelser_ABS_18-1.pdf.
  Referensens tekniska datum 2018-06-13 motsvarar originalfilens datum i namnet;
  kunden ser dokumentets versionsbeteckning 2018.06, inte uppladdningsdatum.
- En behorig POST forbereder en organisations- och projektavgransad fil i
  befintlig privat filbank. GET andrar inte utkastet. Stabil filidentitet och
  uppladdning utan overskrivning gor aterforsok och samtidiga flikar idempotenta.
  Godkant avtal stoppar ny bilageforberedelse fore uppladdning. Aldre utkast
  behaller namn och referenser for redan valda projekthandlingar.
- Avtalsvyn lagger bilagan i utkastets handlingslista genom befintligt autospar.
  Standardraden kan oppnas men inte redigeras/raderas/omordnas som projektfil.
  Byte till egen avtalshandling tar bort bara standardreferensen ur utkastet,
  inte projektfilen eller redan publicerade kopior. Projekttext bevaras.
- Servern normaliserar ABS 18-bilagan aven vid sparning och verifierar dess
  faktiska bytes fore utskick. Befintligt publiceringsflode kopierar PDF:en till
  varje fryst avtalsversion och ger bestallaren atkomst via den versionens filrout.
  Ingen ny SQL eller gransknings-/signeringsrutin infors. Gamla versioner andras inte.
- Status: lokal implementation, inte publicerad. Ingen verklig kundinformation,
  utskick, avtalsversion eller Supabase-lagring andrades under utvecklingstesterna.
- Verifiering: 319 action-case-tester inklusive standardfilens SHA-256,
  samtidiga aterforsok, accepterat avtal, autosparning, bevarade dokument,
  fryst versionskopia och kundens filatkomst. TypeScript och riktad ESLint
  kontrollerade. Fiktiva klicktester omfattar byte av avtalsform under langsamt
  autosparande, omladdning, fel/aterforsok med bevarad text och PDF i ny flik.
  Desktop 1280 och mobil 390 px har ingen horisontell overflow.
  Lokalt produktionsbygge kor Webpack och isolerade byggvarden for Supabase;
  Turbopack stoder inte denna worktrees externa node_modules-lank.

## Skydd for osparade handlingar 2026-10-07

- Dokumentmetadata kunde tidigare finnas bara i editor-minnet efter ett sparfel
  eller fore debouncen. En omladdning kunde darfor tappa osparade namn, datum,
  typ, referenser och ordning. Exakt orsak till det rapporterade produktionsfelet
  kan inte faststallas fran den nuvarande databasen; utkast saknar revisionshistorik.
- Samma lokala utkastprincip som OB:s textfalt anvands, utan ny sparko eller
  bakgrundsuppladdning. Bara handlingsmetadata sparas i flikens sessionStorage,
  avgransat per projekt och med 24 timmars aterstallningsfrist. Personnummer,
  avtalsparter, priser, avtalstexter och filinnehall lagras inte dar.
- Kopian uppdateras direkt vid andring, fore autosparningsfordrojningen. Ett
  bekraftat serversvar rensar bara fardigsparade metadata; nyare redigeringar
  bevaras med den bekraftade versionen som jamforelsegrund.
- Ett ateroppnat olast avtal aterstaller automatiskt endast nar serverns
  handlingslista fortfarande motsvarar kopians bas och samtliga filer finns kvar.
  Vid konflikt visas lokal-kopia-status med val att aterstalla eller behalla
  serverversionen, bada med bekraftelse. Handlingseditorn och utskick vantas tills
  valet ar gjort; andra avtalsfalt kan fortsatt redigeras. Nyare serverhandlingar
  skrivs inte over automatiskt. Redigering i andra vyer fore avtalsvyn far inte
  rensa ett lokalt handlingsutkast som annu inte har granskats.
- Autosparning och manuell sparning verifierar handlingsmetadata i serversvaret
  fore bekraftelse. Inmatning som anlander under en manuell sparning bevaras och
  koas vidare i avtalsvyn. Handlingens datum begransas till fyra arssiffror;
  ogiltig datum-inmatning skickas inte som en ogiltig avtalsreferens.
- Status: lokal implementation, annu inte publicerad. Ingen ny SQL. Dokumenten
  och datumen som anvandaren uttryckligen bekraftade har separat aterstallts i
  testprojektet pa hushub.se och verifierats efter omladdning. Inget avtal skickat.
- Verifierat: 325 action-case-tester, TypeScript och riktad ESLint. Lokala
  klicktester omfattar sparfel, avbruten/remonterad editor, aterstallning genom
  samma autospar, riktig omladdning samt tva flikar med nyare servermetadata.

## Oberoende avtal och registerflikar 2026-10-08

- Beslut: Avtal har egna redigerbara texter, inte samma utkast som Offert.
  Arbetsdelar och avgransningar visas i kompakta oppningsbara rader. Rubrik,
  omfattning, forutsattningar, ingar inte, avradan och pris kan andras direkt.
  Varje arbetsdel kan flyttas/raderas och en tom arbetsdel kan laggas till.
- Hamtning fran Projektarbete eller sparad Offert ar uttrycklig. Valj alla
  eller enskilda rader, sedan Hamta valda och ersatt texter. Belopp behalls
  som standard; Hamta aven kundpriser ar ett separat val. Ej valda rader
  behalls. Tillval importeras inte som en del av det signerade grundatagandet.
- Ny tabell `action_case_customer_contract_drafts` har egna revisioner,
  autosparning, organisationsgranser och service-rollsatkomst. Befintliga
  utkast kopieras en gang utan att radera, sammanfoga eller gissa bland aldre
  dubbla arbetsdelar. Omkord migration skriver aldrig over avtalstexten.
  Offert sparas fortsatt i sin tidigare tabell med egen revision.
- Avtalsparter, strukturerad fastighet, intern kostnadsgrund och betalningsplan
  sparas via avtalsutkastets egna RPC-funktioner. Fakturamottagaren och
  gemensam projektplanering behaller sina befintliga register och behorigheter.
- Publicering fryser avtalets snapshot och bilagor som tidigare. Egen
  `contract_revision` ger idempotent publicering utan kollision med aldre
  offertrevisioner. Godkannande laser nya avtalsutkastet aven mot direkt
  UPDATE/DELETE med service-roll; kopierade publicerade versioner ar oforandrade.
- Projektnavigeringen ar registerflikar overst. Avtalsstatus ligger som en
  hopfallbar fullbreddsrad ovanfor formularet i stallet for en smal hogerspalt.
  Arbetsdelar foljer profilens Tydlig tabell med 60 px normalrader.
- Drift: `docs/db/2026-10-08_01_independent_customer_contract.sql` ar
  installerad i Supabase. Fore apppublicering verifierades alla atta funktioners
  innehall mot releasefilen, tabellens RLS, nekad klientatkomst och triggers.
  Testprojektets kopia och offertutkast hade samma revision 54 och samma body.
  Pausa avtalsredigering mellan migrering och driftsattning: den gamla
  appversionen skriver fortfarande bara till offerttabellen.
  Ingen avtalsversion eller kundutskick andrad under testerna. Aldre dubbla
  rader i ett utkast maste valjas bort uttryckligen.
- Verifiering: 346 action-case-tester inklusive faktisk SQL-korning i PGlite,
  oberoende sparning, revisionskonflikter, nekad klientatkomst, oforandrade
  snapshots och lasning efter godkannande. Lokala klicktester visar import
  fran bada kallorna, egna texter, bibehallna priser, tillagg, borttagning och
  omladdning, sparfel/aterforsok och omordning. TypeScript, riktad ESLint och
  produktionsbygget med Webpack passerar. Tangentbordsbyte mellan registerflikar
  behaller fokus pa vald flik. Datorvyn ar visuellt kontrollerad vid 1280 px.

## Masshantering av avtalsrader 2026-10-08

- Egen krysskolumn markerar enskilda arbetsdelar eller alla, med delmarkerat
  tillstand och rensa markering. Urvalet ar bara lokal UI-status och autosparas
  inte. Verktygsradens hojd andras inte nar antalet valda rader andras.
- Ta bort valda och byte av Ingar som (grundatagande/avgransning) bekraftas
  med berorda namn. Urvalet fryses vid bekraftelsen; bara dessa avtalsrader
  andras. Projektarbete, sparad Offert och ovriga avtalsfalt behalls.
- Avgransning tar bort radens kundpris enligt befintlig normalisering; detta
  visas fore bekraftelsen. Byte tillbaka till grundatagande gissar inga priser.
- Massandringen anvander samma autospar, revisionskontroll, sparfel/aterforsok
  och databaslasning som enskild redigering. Ingen ny SQL eller API.
- Status: ingar i publiceringspaketet 2026-10-08. Verifierad med 353
  action-case-tester, TypeScript, riktad ESLint och produktionsbygge med Webpack.
  Klicktester omfattar delmarkering, valj alla, avbryt, radering, byte av radtyp,
  omladdning, sparfel/aterforsok och lasning efter godkannande. Upp till 200 rader
  och dubbla rubriker testas utan sammanblandning. Layouten ar kontrollerad pa
  dator (1280 px) och mobil (390 px), utan sidledes overflode eller hopp vid
  markering. Riktiga projektrader och kundutskick har inte berorts.

## En gemensam handlingslista 2026-10-08

- Beslut: sektionen Ovriga bilagor tas bort fran Avtal. Dokument och bilder
  valjs i Handlingar som ingar i uppdraget, med typ, namn och datum.
- Redan valda extra bilagor visas som egna rader efter befintliga handlingar.
  Tidigare typ, namn, datum och ordning behalls; nya referenser far filnamnet
  men ingen gissad typ eller datum. Saknade filer visas och kan valjas bort.
- Vid nasta redigering sparas referenser och bilageval i samma autosparning.
  Handlingsuppgifter som saknas maste kompletteras fore utskick. Ej valda filer
  laggs inte till. Borttagning ur listan raderar inte projektets originalfil.
- Lasningen och publicerade snapshots behalls. Offertutkastets egna texter
  och filval andras inte. Ingen ny SQL eller automatisk skrivning i produktion.
- Status: ingar i publiceringspaketet 2026-10-08; drift verifieras efter push.
- Verifierat: 356 action-case-tester, TypeScript, riktad ESLint och Webpack-
  produktionsbygge passerar. Lokal klickkontroll visar att sektionen ar borta,
  att tidigare bilagor visas i handlingslistan och att metadata behalls efter
  redigering, autosparning och omladdning. Ingen riktig kunddata har andrats.

## Uppdragets standardtexter och Ovrigt 2026-10-08

- Beslut: den egna sektionen Bestallarens arbeten och samordning tas bort.
  Befintlig text flyttas till det redigerbara faltet Ovriga overenskommelser
  under Ovrigt, utan att gissa att den avser undantag eller andrad ansvarighet.
  Befintliga villkor i `terms` behalls. Flytten sker bara i olasta avtalsutkast,
  en gang, och sparas med ordinarie revisionsstyrda autosparning.
- `contractDetails.otherAgreements` lagrar texten. Den gamla datanyckeln
  `fields.customerWork` behalls tom for kompatibilitet, men ar inte ett
  obligatoriskt falt i den nya modellen. Dubbla eller dolda gamla texter nekas.
  Publicerade/godkanda versioner aterges oforandrade med sin gamla struktur.
- ABS 18 forbereder de tva tidigare efterfragade styckena fran Uppdraget pa
  sida 2 i [Entreprenadkontrakt ABS 18, 2018.06](https://byggtjanstcms.byggtjanst.se/globalassets/pdf/entreprenadkontrakt-abs-18.pdf):
  byggherreuppgifter/kostnader som inte ingar om inte handlingarna anger annat,
  samt statliga och kommunala avgifter inklusive anslutningsavgifter.
- Texterna ligger i `contractDetails.assignment.standardConditions`, med
  versionsbeteckning och egen redigerbar text. De visas under Uppdraget och
  ingar i avtalsgranskningen och den frysta publicerade versionen. De fylls
  inte pa igen efter egen redigering eller tomning. Byte till egen
  avtalshandling tar bort standardtexten, inte projektets egna undantag.
  Original-PDF:en med allmanna bestammelser forblir oforandrad. Ingen annan
  standardtext, ansvarsfordelning eller juridisk fullstandighet utlovas.
- Migration: `docs/db/2026-10-08_02_contract_other_agreements.sql` maste koras
  fore apppublicering. Den uppdaterar valideringen utan att skriva om utkast,
  godkannanden eller avtalsversioner. Avradan och andra krav kvarstar.
- Status: ingar i publiceringspaketet 2026-10-08. 366 action-case-tester,
  TypeScript, riktad ESLint och Webpack-produktionsbygge passerar.
  SQL testas bade separat och tillsammans med de oberoende avtalsutkasten.
  Klickkontroll med fiktiva uppgifter verifierar flytt utan textforlust,
  autosparning/omladdning, egen redigering av standardtexter, byte av
  avtalsgrund, sparfel/aterforsok, avtalsgranskning och lasning. Mobil 390 px
  har 16 px falttext och inget horisontellt overflode. Ingen produktionsdata
  eller verkligt utskick har berorts.

## Arbetsmiljo som redigerbart grundvarde 2026-10-08

- Beslut: Arbetsmiljo ska vara forifyllt nar ABS 18 valjs, och texten ska kunna
  redigeras i samma falt som tidigare. Ett redigerbart sammandrag av avsnittet
  pa sida 3 i entreprenadkontraktet beskriver entreprenorens normala ansvar,
  arbetsmiljoplan, BAS-U/BAS-P, undantaget nar bestallaren anlitar flera
  entreprenorer, och kontaktuppgifter under Ovrigt. Originalvillkoren ligger
  kvar som oforandrad bilaga; inga personer eller projektspecifika roller gissas.
- Det egna textvardet sparas i `fields.workEnvironment`. Den optionala markoren
  `workEnvironmentDefaultVersion` visar att standardvardet har behandlats,
  sa att egen redigering eller tomning inte ersatts vid autospar eller omladdning.
  Befintlig text och tidigare stallingstaganden behalls. Egna avtalsgrunder
  fylls inte pa automatiskt. Byte av avtalsgrund behaller egen arbetsmiljotext.
- Endast olast avtalsredigering far grundvardet. Offert, kundens granskning
  och publicerade/godkanda snapshots aterger endast den sparade texten.
  Samma autospar, revisionskontroll och lasning som ovriga avtalsuppgifter.
- Versionsmarkoren valideras i samma SQL-migration
  `docs/db/2026-10-08_02_contract_other_agreements.sql`. Ingen datamigrering
  eller andring av tidigare signerade versioner.
- Status: ingar i publiceringspaketet 2026-10-08. 371 action-case-tester,
  TypeScript, riktad ESLint och Webpack-produktionsbygge passerar. Klickkontroll
  med fiktiva uppgifter visar forifyllnad, egen redigering/autospar/omladdning
  och tomning utan aterstalld standardtext. Datorvyn visar bada styckena i
  arbetsmiljofaltet; mobil 390 px har 16 px falttext utan sidledes overflode.
  Befintliga beslut, egen avtalsgrund, dokumentatergivning och SQL-validering
  testas, inklusive bibehallen fullstandighetskontroll efter tomning.

## Manuell infogning av arbetsmiljotext 2026-10-08

- Beslut: knappen `Infoga standardtext` visas vid arbetsmiljofaltet i Avtal
  nar ABS 18 ar valt. Tomma falt fylls direkt. Befintlig text ersatts forst
  efter en uttrycklig bekraftelse; avbryt behaller texten utan sparning.
- Knappen infogar samma redigerbara sammandrag som automatisk forifyllnad,
  inte en ordagrann atergivning av ABS 18-formularet. Ingen annan avtalstext
  andras. Autospar, revisionskontroll och lasning behalls. Ingen ny SQL behovs.
- Egen avtalsgrund, Offert och dokument-/kundvyn har inte denna knapp.
  Nar texten redan motsvarar standardvardet ar knappen inaktiv.
- Verifierat lokalt: 372 action-case-tester, TypeScript och riktad ESLint.
  Klicktest i fiktivt projekt visar avbryt utan textandring, bekraftad
  ersattning, direkt infogning i tomt falt, autospar och bibehallen text efter
  omladdning. Dator och mobil 390 px kontrollerade; inget sidledes overflode.
  Inga verkliga avtalsuppgifter andrades. Ingick i releasepaketet 2026-10-10.

## Avradande med tva avtalsfalt 2026-10-08

- Beslut: Avradande ska motsvara de tva textfalten pa sida 3 i ABS 18:s
  entreprenadkontrakt: vilka kontraktsarbeten entreprenoren avradit fran och
  orsaken. Statusmeny, separat datum och bestallarbesked tas bort fran sektionen.
  Original: https://byggtjanstcms.byggtjanst.se/globalassets/pdf/entreprenadkontrakt-abs-18.pdf
- Olast avtalsredigering markerar `advice.format = contract-fields` och har
  samma autospar/revisionskontroll som tidigare. Befintliga work/reason-texter
  behalls. Ett gammalt bestallarbesked visas redigerbart under Ovrigt och finns
  med dar i nya avtalsversioner. Tidigare datum bevaras som intern bakatkompatibel
  metadata, inte som falt eller datumtext i det nya avtalet.
- Bada tomma falt ar tillatna och sammanfattas neutralt som Inte angivet.
  Bara ett ifyllt falt blockerar utskick men far autosparas. Arbetsdelarnas
  befintliga kontroll for avradan galler fortfarande och kan inte kringgas
  genom att lamna de tva avtalsfalten tomma.
- Gamla publicerade/godkanda snapshots behaller ursprunglig struktur och
  validering. Databasen skriver inte om befintliga avtal. Aldre klienter far
  inte ta bort formatmarkoren fran ett redan uppdaterat avtalsutkast.
- Ny SQL fore publicering: `docs/db/2026-10-08_03_contract_advice_fields.sql`.
- Verifierat lokalt: 378 action-case-tester inklusive den upprepningsbara
  SQL-migreringen, TypeScript och riktad ESLint passerar. Klicktest i fiktivt
  projekt visar exakt tva falt, autospar, bibehallna texter efter omladdning,
  neutral tomning, kompletteringskrav for ett ensamt falt och korrekt
  avtalsgranskning utan separat datum. Tidigare bestallarbesked finns kvar
  under Ovrigt. Dator och mobil 390 px kontrollerade utan sidledes overflode
  eller webblasarfel. Inga riktiga avtal andrades. Ingick i releasepaketet 2026-10-10.
- Produktionsbygget med webpack passerar med projektets befintliga publika
  Supabase-konfiguration. Ett forsta bygge utan dessa miljoindata stoppades
  vid prerendering av den orelaterade sidan admin/access.

## Publiceringskontroll 2026-10-08

- Anvandaren har kort `2026-10-08_02_contract_other_agreements.sql`.
  En lasande kontroll i Supabase visar att `assert_customer_contract` matchar
  releasefilens funktion (MD5 `87a15634cea76a4b1eb704931a7da05b`), har
  service-rollsatkomst och saknar direkt authenticated-klientatkomst.
- Paketet omfattar masshantering av avtalsrader, en gemensam handlingslista,
  flytt av tidigare bestallararbeten till Ovrigt och redigerbara ABS 18-
  grundtexter. Inga kundutskick eller godkannanden ingar i apppubliceringen.
- Senaste `main` med separat publicerat RenoApp-arbete togs in med fast-forward.
  Dessa filer andras inte i Gizmo-committen. Driftstatus verifieras efter push.

## Senare steg, inte implementerade

- Fakturor med tydlig skillnad mellan avtalat, fakturerat och betalt.
  Avtalad totalsumma inkluderar bara accepterade tillval/ATA, inte valfria forslag.
- Beroenden och automatisk produktionsplanering; manuell delad momentlista finns.
- ATA och kompletterande tillval som egna godkannanden, aldrig overskrivning av
  grundavtalet. Flera bestallare/signatarer, foretagskund, flera momssatser och ROT.
- Fardig genererad avtals-PDF, automatisk godkannandekopia via mejl, kundkonton och
  starkare signering. Nu finns kvittensen i kundvyn och webblasaren kan skriva ut.
- AI-stod for offerter och fullstandighetskontroll. Inga AI-priser eller avtalsvillkor
  publiceras automatiskt i denna version.

## Avtalets prisdel 2026-10-08

- Avtalets nya prisdel: fast, lopande eller kombinerat pris i
  `contractPricing` i det oberoende avtalsutkastets body. Prisradernas UUID,
  titel, prisform och kundbelopp ar egna avtalsdata; offert- och projekttexter
  paverkar dem inte efter explicit import. Avtalets omfattning visas alltid,
  aven nar prisredovisningen ar Enbart totalsumma.
- Prisimport valjer kontrollerade kundpriser inkl. moms fran Projektarbete.
  Endast markerade rader ersatts; ingen automatisk material-/arbetsfordelning.
  Ursprunglig klumpsumma bevaras. Byte till delpriser kraver bekraftelse om en
  klumpsumma finns. Vid redovisning med delpriser beraknas summan fran raderna.
- Lopande rakning sparar timpris inkl. arvode/moms, valfritt eget timpris for
  arbetsledning, entreprenorarvode pa sjalvkostnader och ett separat ungefar-
  ligt pris inkl. moms. Ren lopande rakning har `baseAmountOre = null` och
  inget accepterat fast totalbelopp. Blandat pris summerar bara fasta moment
  och kraver explicit uppdelning i fasta/lopande moment fore publicering.
- Public projection tar bort dold radprissattning, kall-ID och inaktiva
  prisgrunder. Kundens godkannande avser hela den frysta prisformen och dess
  grunder, inte ett falskt totalbelopp. Historiska avtal utan `contractPricing`
  normaliseras, renderas och valideras enligt sin ursprungliga prismodell.
- SQL: kor `2026-10-08_03_contract_advice_fields.sql` och sedan
  `2026-10-08_04_contract_pricing.sql` fore publicering. _04 validerar belopp,
  summering och kompletta prisgrunder vid sparning/publicering/godkannande,
  behaller revisions-/organisationslasen och stoppar aldre klienter fran att
  kasta det nya prisformatet. Inga historiska texter eller belopp skrivs om.
- Betalningsplanens fasta delbetalningar maste fortfarande motsvara den fasta
  summan. Prisbyte skriver aldrig om planen. En tidigare fast betalningsplan
  maste tas bort/anpassas innan ett helt lopande avtal kan publiceras; faktura-
  villkor anges separat. Fordelning av faktiska lopande fakturor ar inte byggd.
- Verifiering av prisdelen lokalt: 392 action-case-tester godkanda, inklusive 36
  kombinationer av prisform, uppdelning, berakningsgrund och presentation.
  TypeScript, fokuserad ESLint och produktionsbygge med webpack godkanda.
  Klicktestat med riktiga komponenter och fiktiv lokal HTTP-backend: vald och
  full prisimport utan dubbletter, decimalbelopp, autosparning och omladdning,
  tre presentationslagen, separat arbete/material, manuellt fast pris och
  bekraftat/avbrutet byte till radsumma. Blandat pris skiljer ut lopande moment
  fran fast summa; ren lopande rakning visar prisgrunder utan fast totalsumma.
  Timpris, arbetsledning, arvode och ungefarligt pris bevaras efter omladdning.
  Sparfel/aterforsok, prisradering med bevarad omfattning och lasning efter
  simulerat godkannande verifierade. Kundens lasvy visar de frysta priserna.
  Dator och mobil 390 px visuellt kontrollerade; hela sidan saknar sidledes
  overflode. Den separata arbets-/materialtabellen rullar internt i mobilvy
  sa att belopp inte bryts mitt i siffrorna. Ingen skarp kunddata har andrats,
  inget avtal skickats. Produktionskontrollen for SQL _03 och _04 finns nedan.

## Publiceringskontroll 2026-10-10

- Anvandaren bekraftade att SQL _03 och _04 har korts. En lasande kontroll i
  produktion verifierade det nya avradandeformatet, prisvalideringen och dess
  anrop vid avtalspublicering. Bada formatvakterna ar aktiva pa avtalsutkast.
  Valideringsfunktionerna tillater service-roll, inte direkt authenticated-
  klientatkomst. Inga projekttexter, belopp eller avtalsversioner andrades.
- Releasepaketet omfattar arbetsmiljons standardtextknapp, avradandets tva
  avtalsfalt och den oberoende prisdelen. Senaste publicerade main togs in med
  fast-forward utan overlapp i paketets filer; parallella arbetskopior lamnades
  ororda. 392 action-case-tester och TypeScript passerade pa denna bas.
  Riktad ESLint har inga fel och tre befintliga varningar i testservern.
- Driftstatus och kundvyn kontrolleras efter push. Apppubliceringen skickar
  inte offerter eller avtal och godkanner inga kundhandlingar.
