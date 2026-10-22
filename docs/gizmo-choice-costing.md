# Val och tillval: egna kalkylrader

Beslut 2026-10-19. Galler Uppdrag, inte RenoApp eller avtalsredigeringen.

- Varje alternativ har en egen kalkyl i hogerpanelen, likt Projektarbete.
  Tabellen visar Klar, Kalkylrad, Kostnad, Paslag och Kundpris exklusive moms.
  Material, montage och ovriga kostnader ar egna redigerbara rader.
- Pennan oppnar benamning, kostnad, procentpaslag och valfritt fast paslag.
  Egna rader kan laggas till, tas bort och aterstallas. Klar ar intern uppfoljning
  och paverkar aldrig summeringen eller om ett belopp anses finnas.
- Kalkylrader raknar om alternativets kundpris direkt. Moms beraknas pa
  totalsumman. Ingen separat Anvand kundpris-knapp finns i Val och tillval.
  Inkompletta rader ger Pris ej faststallt, inte en gammal kvarvarande summa.
- Samlat kundpris finns kvar som ett uttryckligt prisval. Kalkylraderna bevaras
  nar manuellt pris valjs. Att aterga till Kalkylrader ar ett aktivt val.
- Befintliga kalkyler visas utan automatisk omskrivning. Offertens inkop blir
  materialraden och tidigare montage/tillagg egna rader; fast paslag behalls.
  Befintliga kundpriser som avviker fran kalkylen visas som Samlat kundpris.
  Omvandling till radformat sker forst nar anvandaren redigerar.

## Avtalets oberoende

Kalkylen lagras endast i `action_case_customer_planning.internal_costing`.
Priset tillhor alternativets `budgetOre`, inte nagot avtalsbelopp.
Offertredigerarens befintliga kalkylkomponent andras inte. Inga nya skrivningar
till Projektarbete, offertutkast, avtalsutkast, betalningsplaner, lasningsversioner
eller arkiverade PDF:er tillkommer. Delade kundversioner andras inte vid sparning;
delning ar fortfarande en egen, uttrycklig handling. Inga mejl skickas vid sparning.

## Lagring och aterhamtning

Den befintliga privata JSON-lagringen och revisionskontrollerade RPC:n ateranvands.
Ingen SQL-migrering behovs. Servern validerar rad-ID:n, belopp, paslag, komplettstatus
och gransvarden och raknar sjalv fram kundpriset i beraknat lage. Den laser tidigare
privat kalkyl inom samma organisation och projekt innan sparning; en aldre klient
far inte ersatta radkalkylen med det gamla formatet eller tomma uppgifter.
Den ordinarie revisionskontrollen avvisar samtidiga andringar. En borttagen
alternativrad far fortfarande rensa sin egen privata kalkyl.

## Beslutslogg

- 2026-10-22: Utokningen med mangd/enhet, separat kundpris, prisform, tid och PDF
  beskrivs i [Val och tillval: pris, tid och PDF](gizmo-choice-offers.md).
  Den utokningen kraver en ny SQL-migrering; tidigare radkalkyl gjorde det inte.

- 2026-10-19: Anvandaren godkanner samma radbaserade arbetssatt som i Projektarbete,
  automatiskt kundpris utan Anvand kundpris och ett fortsatt helt separat avtal.
  Sidopanelen far vara bredare. Publicering ar godkand nar verifieringen ar klar.
  Leverantorsofferter far bifogas med inkopspriser, men delning och oklara
  montage-/kundpriser maste hanteras separat fran denna kodandring.

## Verifiering fore publicering

- 580 action-case-tester passerar, inklusive modellens sju nya tester och
  serverprov for separat lagring, omrakning och skydd mot aldre klienter.
- Produktionsbygge med webpack och Nexts TypeScript-kontroll passerar.
  Riktad ESLint passerar. En fristaende full `tsc` rapporterar fortfarande
  fem befintliga importandelsefel i fyra andra modulers testfiler; dessa filer
  andras inte av denna uppgift och Nexts produktionskontroll filtrerar tester.
- CUA-klickprov med fiktivt projekt: andrat montage och eget paslag, tomt pris,
  Klar utan prisandring, lagg till, ta bort, angra, manuellt pris och atergang
  till kalkyl. Ny oberoende sidladdning visar samma sparade belopp och Klar.
  Ett simulerat sparfel behaller alla rader och aterforsok fungerar.
- Dator samt fasta mobilbredder 390/344 px ar visuellt kontrollerade med
  produktionskomponenterna: staplade, markta belopp och radbrutna namn.
  Inga riktiga projektuppgifter, avtal, kunddelningar eller utskick anvands.
- Driftsatt version och skrivfri integritetskontroll verifieras vid publicering.
