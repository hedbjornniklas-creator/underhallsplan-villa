# Projektets avsandare och offert-PDF

## Beslut 2026-11-03

- Projektet har en gemensam avsandarprofil. Valet redigeras endast under Oversikt.
  Offert och Avtal visar vald avsandare utan egna profilvaljare.
- Ett uttryckligt, bekraftat profilbyte uppdaterar foretagsuppgifter i bada
  redigerbara utkasten atomart. Omfattning, priser, kontaktperson, betalningsplan
  och redan skickade eller frysta dokument skrivs inte om.
- Redan vid Las for signering forsvinner profilvaljaren och Anvand profil for
  hela projektet. Registrerad signerad kopia eller accepterat avtal sparrar ocksa
  byte. Serversparren galler aven gamla flikar och den aldre profilrutinen.
  Detta ersatter tidigare mojlighet att byta avsandare for nya utkast efter lasning.
- Profilbyte maste invanta sparade andringar. Under ett obekraftat sparsvar
  blockeras dokumentredigering; samma begaran kan aterforsokas utan dubbelskrivning.
- Offert kan hamtas som PDF fran sparad revision, utan krav pa digital signering
  eller komplett offert. Under pagaende sparning eller sparfel blockeras hamtning.
  Om revisionen andras under rendering avbryts hamtningen i stallet for att ge en
  gammal PDF. Utskriften lagrar eller skickar inget och laser inte avtalet.
- Offert och Avtal delar PDF-motor, logotyp, typsnitt och grundlayout. Offerten har
  rubriken Offert, offertens omfattning, priser och villkor, och inga
  avtalsunderskrifter. Intern kalkyl och personnummer tas inte med.
- Lasta avtal och historiska utskick behaller sin frysta avsandare och sina filer.
  Inga befintliga projekt eller dokument skrivs om vid installation.

## Offertpresentation 2026-11-03

- Bestallartyp kan redigeras aven nar offerten anvander en egen avtalshandling.
  Valet av foretag/forening byter inte avtalsgrund eller priser automatiskt.
- Numrerade stycken i offertens inledning far en separat underrubrik nar den
  forsta raden ar en numrerad titel. Text och belopp tolkas inte som kalkylrader.
- En offert utan grundmoment och utan strukturerat totalbelopp skriver inte ut
  en tom pristabell. Nollbelopp och ofullstandiga verkliga prisrader behalls.
- Valbara delar summeras inte automatiskt. Avtalsutskriftens presentation och
  redan frysta PDF-filer andras inte av detta.
- Offerten pagineras lopande utan framtvingat sidbyte efter parterna. Brodtexten
  ar 10,5 punkter; rubrikstorlekarna behalls. Tomma undertecknar- och okontrollerade
  F-skattefalt skrivs inte ut i offert, men behalls for handifyllnad i avtal.
- Beslut: valbara offertdelar sparas uttryckligen i offertutkastets
  `offerAlternatives`, med datum, rubrik, omfattning, fast delpris exklusive
  moms och villkor for sammanrakning. Inga belopp beraknas fran fritext.
  Vanlig omfattning, kontraktspris och betalningsplan blandas inte med denna form.
- Offertvyn och vanlig PDF-knapp visar Arbeten, Priser, Tid, Betalningsvillkor,
  ATA och Bestallning fran sparade uppgifter. Delarna summeras inte innan de
  bestallts. Offerten skickas manuellt som PDF; inget digitalt godkannande byggs.
- Datum, omfattning och priser ar redigerbara med befintlig autosparning.
  API:t avvisar aldre flikar som saknar redan sparade valbara offertdelar.
  Explicit `null` ar nodvandigt for att ta bort formatet; faltet tappas aldrig tyst.
- Uppgifterna far inte skrivas till avtalsutkast. Automatisk avtalsutskickning
  blockeras tills valda delar har avtalats separat. Projektarbete, lasta avtal
  och betalningsplan andras inte.
- Befintlig JSON-lagring ateranvands. Ingen ny SQL-migrering behovs for detta.

## Komplettering av offertuppgifter 2026-11-03

- Nar offertvyn oppnas hamtas saknade bestallar- och fastighetsuppgifter fran
  projektets sparade avtalsuppgifter. Kopplad fastighet anvands som reserv om
  avtalsutkastet inte har strukturerade fastighetsuppgifter.
- Uppgifterna visas i offertutkastet och sparas med dess vanliga revisionsstyrda
  autosparning innan PDF-knappen blir tillganglig. PDF-mallen gor ingen dold
  sammanslagning med nyare avtalsdata.
- Redan ifyllda offertuppgifter behalls. Olika bestallare eller adresser blandas
  inte. Personnummer, avsandare, priser, omfattning, betalningsplan och villkor
  kopieras inte. Fastigheten visas aven under offertuppgifter.
- Kopplingen skriver endast offertutkastet. Avtal, Projektarbete, kundregister,
  skickade versioner och lasta dokument andras inte. Inga nya SQL-steg kravs.

## Rubrik for offertbilagor 2026-11-03

- Offertens dokumenttabell har rubriken Handlingar och bilagor som hor till
  offerten. Rubriken visas aven nar tabellen ar forst under Uppdraget och
  offertens inledning ar tom. Arbetets omfattning foljer som egen underrubrik.
- Detta andrar enbart offertens presentation. Dokumenturval, filer, priser,
  omfattning och avtalsutskriftens befintliga rubriker behalls.
- Offert har eget dokumentval under Handlingar och bilagor. Den befintliga
  dokumentredigeraren ateranvands, men sparar bara offertens val, namn, typ,
  datum och ordning. Borttagning tar inte bort projektfilen och paverkar inte
  Avtal, omfattning eller priser. Projektfiler valjs inte automatiskt.
- Varje offertbilaga kan inkluderas i PDF eller vara endast referens. Dolj tar
  bort den fran offertens urval, inte fran projektet. Nya valda PDF-filer far
  laget inkludera; andra filtyper kan bara vara referenser. Befintliga val andras
  inte fran referens till inkluderade sidor utan ett uttryckligt val.
- Lagena lagras i offertens `offerDocuments`. Aldre flikar utan detta falt far
  inte tyst kasta sparade val. Avtalsutkast accepterar inte denna offertmetadata.
- HF17 ligger forvalt och kan inte tas bort eller flyttas fran standardraden.
  Den verifierade originalfilens sida med allmanna bestammelser laggs sist i
  samma offert-PDF. De tre tomma blankettsidorna bifogas inte. Saknad eller
  felaktig standardutgava stoppar PDF-hamtningen; en ofullstandig PDF lamnas
  inte ut. Ovriga valda PDF-sidor laggs fore HF17 i dokumentordningen. Endast
  referenser listas men deras sidor slas inte ihop. Fil-lankarna finns kvar.
- Inkluderade filer kontrolleras mot organisation och projekt, privat filtyp,
  storlek och tillganglighet. Fragors privata filer och interna offertunderlag
  far inte inkluderas. Interaktiva formular, kommentarer och aktiva PDF-atgarder
  avvisas i stallet for att tyst forandra eller tappa deras innehall.
- Sammanfogningen anvander en gemensam PDF-hjalpfunktion och `pdf-lib`.
  Originalsidans utseende och offertens metadata behalls. Befintliga frysta
  avtals-PDF:er och utskick andras inte. Ingen SQL-migrering kravs.

## Installation

Kor `docs/db/2026-11-03_01_running_price_budget.sql` och darefter
`docs/db/2026-11-03_02_project_sender_profile.sql` fore publicering.
Profilandringen ateranvander den befintliga projektkopplingen och requestloggen.
Den tillfor ingen anonym eller inloggad direktatkomst till de privata rutinerna.

## Verifiering

- Sender SQL- och servertester: bada utkast, revisionskontroll, aterforsok,
  organisationsgranser, identitetsskydd och lasning, utan historiska omskrivningar.
- Sender UI-tester: bekraftelse, gamla svar, sparfel, profilbyte fore forsta
  dokumentet och gemensam placering med sparr i bada dokumentredigerarna.
- Offert-PDF-tester: ratt sparad revision, fryst avsandare, kundprojektion,
  autentiserad privat hamtning, inga mutationer och separat offertrubrik.
- Klicktest och visuell PDF-granskning anvander endast fiktiva projekt.
