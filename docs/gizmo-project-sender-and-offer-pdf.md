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
