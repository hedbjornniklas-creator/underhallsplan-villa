# Projektdagbok

## Godkant 2026-11-04

- En egen Dagbok i Uppdrag. Datum, ungefarlig tid fran/till, namn, foretag,
  kort arbetsbeskrivning, valfritt moment och hogst 20 bilder per anteckning.
- QR-lappen ar pa svenska med rubriken Dagbok pa arbetsplatsen, projektnamn,
  kort instruktion och bildgranser. Ingen logga eller utskriven lank visas.
- Tider skrivs som siffror i stallet for telefonens klockvaljare; exempelvis
  0700 blir 07:00. Det ar tid pa plats, inte en arbetstids- eller lonerapport.
  Tid ar frivillig: fran och till kan bada vara tomma. Om tid anges behovs
  bada falten och sluttiden ska ligga efter starttiden samma dag. Saknad tid
  lagras utan minuter (null), inte som noll arbetade timmar. Ingen tom tidsrad
  visas i kvittot, anteckningen eller versionshistoriken.
  Rast finns inte i nya formular och nya anteckningar har inget rastavdrag.
  Aldre original och pagaende aterforsok behaller sitt ursprungliga innehall.
  Aldre rastuppgifter finns under Registreringsuppgifter, inte i huvudvyn.
- Projektansvarig aktiverar, skriver ut, byter eller stanger projektets QR-lank.
  Lanken ar avstangd fran borjan och ger aldrig projekt- eller kundbehorighet.
- QR-formularet oppnas direkt, utan mejlkod, konto eller annan identitetskontroll.
  Besokaren valjer en person ur projektets lista eller lagger till namn och foretag.
  Samma namn och foretag, efter normalisering av skiftlage och mellanrum,
  ateranvands i stallet for att skapa en dublett. Andra stavningar kan inte
  sakert kopplas till samma verkliga person utan identifiering.
- Telefonen minns valt person-ID per projekt i localStorage. Byt person ar alltid
  synlig; pagaende utkast kravs bekraftelse innan de lamnas. Olika personers
  lokala utkast halls isar. En annan flik far inte byta namn pa ett oppet utkast.
- Alla med den aktiva QR-lanken kan se projektets namnlista (namn och foretag)
  och momentens rubriker, men aldrig mejladresser, historik, andra personers
  bilder, kunduppgifter, priser eller avtalsuppgifter.
- Namnvalet ar helt sjalvuppgivet: vem som helst med koden kan valja ett annat
  namn. Nya QR-anteckningar marks som personval, aldrig verifierad identitet.
- Interna medlemmar med Uppdragsbehorighet kan lasa dagboken och registrera
  anteckningar. Bara projektansvarig kan lagga till en sparad rattelse.
- Sparade original, bildmanifest och rattelser ar append-only. Arbetsdatum
  skiljs fran serverns mottagningstid; bilder far en SHA-256-kontrollsumma.
- Inloggad projektansvarig kan redigera datum, tider, arbetsbeskrivning, moment
  och bilder under 48 timmar fran serverns ursprungliga mottagningstid.
  Varje sparning skapar en ny version; original, tidigare bilder, andringstid
  och den inloggade redigerarens namn bevaras. Senaste versionen visas normalt.
  Efter tidsgransen anvands befintlig rattelsefunktion. Person/foretag och
  ursprunglig registreringsmetod andras inte genom redigeringen.
- QR-sidan har ingen lasning eller redigering av sparade anteckningar, inte
  heller for den som skickade in dem. Ingen telefonkoppling anvands for
  redigeringsbehorighet. Befintlig enhetscookie skyddar bara uppladdningar
  och aterforsok som tidigare.
- Anteckningar visas minimerade med datum, person och foretag pa raden.
  Innehall, bilder, historik och interna kommandon visas nar raden oppnas.
- Inga anteckningar skapar timmar i kalkyl, bestallningar, fakturor, ATA,
  betalplaner eller andringar i avtal. Ingen kunddelning sker automatiskt.

## Teknisk avgransning

Egen lagring under action_case_diary_* och en egen privat bildbucket.
Mina uppdrags konton och behorigheter andras inte. QR genereras lokalt av
qrcode, inte av en extern QR-tjanst. En slumpmassig HttpOnly-enhetscookie
avgransar pagaende uppladdningar och aterforsok; den identifierar ingen person.
Val av samma namn pa en annan telefon ger aldrig tillgang till dess bilder.
Gamla QR-lankar stoppas vid byte eller stangning. Bilder laddas normalt direkt
till ett tillfalligt privat objekt, kontrolleras pa servern och arkiveras pa en
separat, ej overskrivbar sokvag innan de kan knytas till en anteckning.
JPG, PNG och WebP, hogst 8 MiB per bild och 20 bilder per anteckning.
Bildinnehall och storlek kontrolleras, inte bara filnamnet. Uppladdningar koas
med hogst tre samtidiga bildfloden per formular. Befintliga dygnskvoter och
agarskydd behalls. Orphan-uppladdningar forfaller efter 24 timmar och rensas
begransat vid projektansvarigs besok, efter 15 minuters sakerhetsmarginal for
pagaende bildanrop (servergrans 60 sekunder). En kvitterad rensning gar vidare
till nasta batch; lagringsfel kan provas igen. Bifogade bilder rensas aldrig.

Kvitton och request-ID gor aterforsok idempotenta. Ett osakert sparsvar far
inte skapa en andra anteckning eller kasta texten. Ett pa-borjat formulartutkast
skiljs fran en inskickad och mottagen dagboksanteckning.

SQL-migreringen ar additiv och skriver aldrig om original eller andra moduler.
Mejlkodsflodet ar borttaget fran applikationen och de gamla RPC-ingangarna
stangs av i migreringen. Tidigare verifieringsuppgifter och original behalls
for historik. Namnlistan fylls fran gamla anteckningar utan att skriva om dem.
Ingen publicering ingar fore separat godkannande.

## Reservvag For Bilduppladdning, 2026-11-06

Incidentkontrollen hittade 20 forberedda bildposter i Gashaga den 5 november
18.51, men inga mottagna bildobjekt eller nagon anteckning fran det forsoket.
Alla filer lag under 8 MiB. Direkt uppladdning av en fiktiv 5 MiB-bild fungerar
vid kontrollen dagen efter. Den exakta orsaken pa telefonen ar inte faststalld.
Lagringsloggarna visar lyckade forberedelser och gateway-loggen visar att
Chrome pa Android fick svar pa OPTIONS-forfragan, men ingen efterfoljande
PUT for den kontrollerade bilden. Detta avgransar felet men bevisar inte
om det berodde pa fillasning, webblasarkontroll eller natverk.

Formularet tar nu en stabil bytekopia fran telefonens galleri. Om direkt
overforing misslyckas kontrolleras forst om bilden redan mottagits. Annars
anvands samma Hushub-origin med hogst fyra delar om 2 MiB. Varje anrop
avgransas till befintlig reserverad bild, aktiv lank/enhetscookie eller
inloggad medlem, organisation, projekt, agare, forfallotid och exakt delstorlek.
Delar ar privat temporar lagring med den reserverade bildens MIME-metadata;
de kan aldrig lasas via dagboken eller bifogas en anteckning. Servern satter
samman och avkodar hela originalet innan dess SHA-256 och befintliga
forseglingskommando anvands. Ofullstandiga bilder bifogas aldrig.

Aterforsok ateranvander bild-id. En befintlig del skrivs inte over; identiska
bytes godtas, andra bytes avvisas. Arkiverade original tas aldrig bort vid
osakert sparsvar. Temporara delar omfattas av befintlig avgransad rensning.
Ingen SQL, ny bucket, andrad hemlighet eller ny QR-lank behovs.

Fel forklaras pa svenska och formularet visar nar bilder hindrar inskickning.
Flera fel kan provas igen tillsammans. Texten behalls under pagaende forsok.
Bildfiler finns fortfarande bara pa telefonen tills de har mottagits; ingen
offline-bildlagring eller garanti om aterstallning efter stangd flik tillkommer.

## Aktivering och kontroll

1. Grundmigreringen `docs/db/2026-11-04_01_project_diary.sql` behovs forst.
   Kor sedan `docs/db/2026-11-04_02_project_diary_people.sql` direkt fore den
   matchande publiceringen. Gamla mejlkodsformular slutar fungera nar den kors.
   For 20 bilder behovs aven `docs/db/2026-11-04_03_project_diary_twenty_photos.sql`.
   Den hojer bara antalsgransen, inte filstorlek eller dygnskvoter.
   For intern 48-timmarsredigering behovs darefter
   `docs/db/2026-11-05_01_project_diary_revisions.sql` fore matchande publicering.
   Den lagger till versionshistorik och en intern aktuell-vy utan att skriva om
   original eller ge QR-besokare las-/redigeringsbehorighet.
   For frivillig tid behovs `docs/db/2026-11-14_01_project_diary_optional_time.sql`.
   Den tillater tom tid vid intern och publik registrering samt intern redigering.
   Befintliga anteckningar och QR-lankar skrivs inte om.
2. Mejltjanst behovs inte. Basadress tas fran `APP_BASE_URL` eller
   `NEXT_PUBLIC_APP_URL` och ska vara en HTTPS-adress i produktion.
3. `PROJECT_DIARY_LINK_SECRET` kan anges som separat hemlighet med minst
   32 tecken. Annars anvands befintlig serverhemlighet. Byte av denna
   hemlighet kraver nya utskrivna QR-koder.
4. Projektansvarig oppnar Dagbok och aktiverar QR-lanken. Ingen lank
   aktiveras genom migreringen. Befintliga utskrivna QR-koder behaller adressen,
   men oppnar det nya personvalet efter publicering.

Lokal fiktiv provvy startas med `node --experimental-strip-types
scripts/test-project-diary-ui.mjs`. Ingen e-post eller produktionsdatabas
anvands. Databastester anvander PGlite och kontrollerar
att projekt-, avtals-, offert- och kalkylunderlag forblir oforandrade.

## Beslutslogg

- 2026-11-14: Anvandaren gor arbetstid frivillig i Gizmos dagbok. Datum,
  person och arbetsbeskrivning kvarstar. Tomma tidsfalt ger ingen beraknad tid och
  inga andringar i avtal eller kalkyl.

- 2026-11-04: Forsta versionen anvande mejlkod och 30-dagarssession.
- 2026-11-04: Anvandaren ersatte uttryckligen mejlkoden med en enkel personlista
  utan identifiering. Listan ar projektbunden, telefonen minns valet och historik
  behalls. Detta ersatter, inte kompletterar, det tidigare verifieringskravet.
- 2026-11-04: QR-lappen forenklas till svensk instruktion utan varumarkeslogga
  eller synlig lank. Tid avser ungefarlig narvaro; rastfalt tas bort och
  bildgranser visas direkt i formularet. Ingen andring av sparade original.
- 2026-11-04: Anvandaren hojer gransen till 20 bilder per anteckning.
  Gransen galler formular, QR-lapp, API och databas. Hogst 8 MiB per bild kvarstar.
- 2026-11-05: Anvandaren godkanner 48 timmars versionsbevarande redigering,
  men endast for inloggad projektansvarig i Hushub. Forslaget om redigering
  fran avsandarens telefon avvisas; QR ar enbart for inlamning. Ingen annan
  projektroll far redigeringsratt genom detta beslut. Rader ar minimerade
  fran borjan. Original och andra modulers uppgifter skrivs inte om.
- 2026-11-06: Anvandaren godkanner publicering av reservvagen for misslyckad
  bilduppladdning och tydligare aterforsok. Befintliga QR-lankar, original,
  avtal och kalkyler ska behallas. Ingen ny databasandring behovs. Reservvagen
  ar en robusthetsrattning, inte en bekraftelse av telefonincidentens grundorsak.
- 2026-11-12: Dagboksbilder ska inga i Bilder och filer och kunna valjas i en
  fraga. Befintlig bildbank och bildvisare ateranvands. Endast valda bilder
  kopieras till fragans privata bilagor; ingen automatisk delning eller andring
  av dagboksoriginal, QR-lankar, avtal eller kalkyl.

## Bildbank och fragor (2026-11-12)

Dagbokens aktuella bilder visas aven i projektets Bilder och filer, med datum,
person, foretag och moment. Bildrutnat, storleksval och fullskarmsvisare
ateranvands fran Gizmo. Visningen ar intern och lasande: originalen kopieras
inte, och borttagna bilder i senare dagboksrevisioner aterpubliceras inte.
Reservuppladdningar och historiska bildmanifest ingar inte i bildbanken.

I en sparad fraga kan anvandaren valja flera dagboksbilder vid bilagorna eller
i Kommunikation. Endast uttryckligen valda bilder kopieras till fragans
befintliga privata bilagelagring. Kopian bevarar underlaget oberoende av senare
dagboksredigering och kan aterforsokas utan dubbla bilagor. Att bifoga delar
inte dagboken och skickar inget mejl. Delning sker med befintliga uttryckliga
kommandon. Fragans deltagarbehorighet kontrolleras pa servern. Publika
fragesidor och QR-dagboken far ingen bildbanksatkomst.

Ingen ny SQL, QR-lank eller publik bucket behovs. Avtal, priser, kalkyler och
befintliga dagboksoriginal andras inte av dessa funktioner.

## Senare, Inte Bestallt

Kunddelning, faktureringsunderlag, automatisk tidsrapportering, vader,
geopositionering, offline-bildsynk och PDF-export av hela dagboken ingar inte.
