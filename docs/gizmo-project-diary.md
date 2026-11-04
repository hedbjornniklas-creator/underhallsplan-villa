# Projektdagbok

## Godkant 2026-11-04

- En egen Dagbok i Uppdrag. Datum, ungefarlig tid fran/till, namn, foretag,
  kort arbetsbeskrivning, valfritt moment och hogst atta bilder per anteckning.
- QR-lappen ar pa svenska med rubriken Dagbok pa arbetsplatsen, projektnamn,
  kort instruktion och bildgranser. Ingen logga eller utskriven lank visas.
- Tider skrivs som siffror i stallet for telefonens klockvaljare; exempelvis
  0700 blir 07:00. Det ar tid pa plats, inte en arbetstids- eller lonerapport.
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
- Inga anteckningar skapar timmar i kalkyl, bestallningar, fakturor, ATA,
  betalplaner eller andringar i avtal. Ingen kunddelning sker automatiskt.

## Teknisk avgransning

Egen lagring under action_case_diary_* och en egen privat bildbucket.
Mina uppdrags konton och behorigheter andras inte. QR genereras lokalt av
qrcode, inte av en extern QR-tjanst. En slumpmassig HttpOnly-enhetscookie
avgransar pagaende uppladdningar och aterforsok; den identifierar ingen person.
Val av samma namn pa en annan telefon ger aldrig tillgang till dess bilder.
Gamla QR-lankar stoppas vid byte eller stangning. Bilder laddas direkt
till ett tillfalligt privat objekt, kontrolleras pa servern och arkiveras pa en
separat, ej overskrivbar sokvag innan de kan knytas till en anteckning.
JPG, PNG och WebP, hogst 8 MiB per bild. Bildinnehall och storlek kontrolleras,
inte bara filnamnet. Orphan-uppladdningar forfaller efter 24 timmar och rensas
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

## Aktivering och kontroll

1. Grundmigreringen `docs/db/2026-11-04_01_project_diary.sql` behovs forst.
   Kor sedan `docs/db/2026-11-04_02_project_diary_people.sql` direkt fore den
   matchande publiceringen. Gamla mejlkodsformular slutar fungera nar den kors.
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

- 2026-11-04: Forsta versionen anvande mejlkod och 30-dagarssession.
- 2026-11-04: Anvandaren ersatte uttryckligen mejlkoden med en enkel personlista
  utan identifiering. Listan ar projektbunden, telefonen minns valet och historik
  behalls. Detta ersatter, inte kompletterar, det tidigare verifieringskravet.
- 2026-11-04: QR-lappen forenklas till svensk instruktion utan varumarkeslogga
  eller synlig lank. Tid avser ungefarlig narvaro; rastfalt tas bort och
  bildgranser visas direkt i formularet. Ingen andring av sparade original.

## Senare, Inte Bestallt

Kunddelning, faktureringsunderlag, automatisk tidsrapportering, vader,
geopositionering, offline-bildsynk och PDF-export av hela dagboken ingar inte.
