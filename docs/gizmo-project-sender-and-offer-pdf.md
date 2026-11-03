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
