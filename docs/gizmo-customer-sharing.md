# Delning av projektets kundflikar

## Beslut 2026-10-20

Användaren har godkänt en intern flik Delning sist i projektnavigeringen.
Projektansvarig styr fem kundflikar: Avtal, Val och tillval, Betalningsplan,
Tidsplan samt Bilder och filer. Övriga interna användare med modulåtkomst
kan läsa inställningarna och förhandsgranska men inte ändra dem.

- Reglagen autosparar. Ingen separat sparknapp eller automatisk publicering.
- Visa innebär att redan uttryckligen delat underlag får visas. Utkast,
  interna kalkyler, offertunderlag och interna anteckningar delas inte.
- Dölj tar bort både fliken och dess särskilda data ur kundens portalsvar.
  Nya anrop till flikens kund-API och gamla direkta filadresser kontrolleras
  på servern. Att bara gömma en knapp är inte ett behörighetsskydd.
- Visa som beställare använder samma läsning och filtrering som kundportalen,
  för en uttryckligen vald, registrerad beställare i projektet. Den skapar
  ingen kundlänk, publicerar inget och uppdaterar inte länkhistoriken.
- Frågor och beslut påverkas inte. Där gäller varje frågas deltagarlista.
  Projektarbete och administration blir aldrig kundflikar.

### Avtal är en separat handling

Reglagen ändrar aldrig avtalstext, pris, låsning, version, PDF, bilageurval,
signering, delningsbeslut eller betalningsplan. En redan delad avtalshandling
behåller sitt hela innehåll, inklusive sin betalningsplan, tidtext och bilagor,
även om motsvarande separata projektflik döljs. Avtalets bilagor hör till
Avtal; Bilder och filer styr endast separat delade projektfiler.

Betalningsplan och avtalets tidtext skickas som egna begränsade projektioner
när deras flikar är synliga men Avtal är dolt. Hela avtalet skickas inte till
webbläsaren för att kunna visa dessa delar.

### Befintliga projekt

Utan sparad inställningsrad gäller tidigare synlighet (alla fem reglage på).
Migreringen skapar inga rader och ändrar inte redan delat innehåll.
Äldre generiska kundportaler behåller sitt tidigare flöde tills
projektansvarig uttryckligen sparar en delningsinställning. Därefter används
den kontrollerade kundvyn med endast uttryckligen delat material.

## Implementation

- `customerSharing.ts`: tillåtna flikar, mutation och kundprojektion.
- `customerSharingServer.ts` och `/api/action-cases/[caseId]/sharing`:
  organisationsavgränsad läsning och skrivning, serververifierad projektansvarig.
- Separata tabeller `action_case_customer_visibility` och
  `action_case_customer_visibility_events`. Inga skrivningar till avtals-,
  offert-, projektarbets-, val- eller betalplantabeller.
- En atomisk RPC låser projektet, kontrollerar aktuell projektansvarig och
  revision, ändrar en enda boolean och skriver en oföränderlig historikpost
  med aktör och före/efter. Samma begäran kan återförsökas utan dubbel ändring.
- RLS och inga direkta klientskrivrättigheter. Saknad eller felaktig schema-
  konfiguration avbryter läsningen; den öppnar inte åtkomst som reservlösning.
- Klientens kö bevarar senaste avsikt vid snabba ändringar, sent sparsvar och
  sparfel. Annan fliks senare fält ändras inte av en gammal helhetskopia.
- Intern och extern data levereras utan cachelagring. Kortlivade, redan
  utfärdade lagringslänkar kan fungera tills de löper ut (normalt 60 sekunder).

## Införande och begränsningar

Kör `docs/db/2026-10-20_01_project_customer_sharing.sql` före publicering.
Den förutsätter projektansvarig och deltagarschemat från
`2026-10-19_04_project_question_dialogue.sql` och
`2026-10-19_05_project_question_participants.sql`.

Inställningarna gäller projektets beställare gemensamt, inte olika flikar för
varje person. Förhandsvisningen väljer person eftersom befintlig delning och
filåtkomst fortfarande är mottagarspecifik.

En redan öppen kundsida uppdaterar menyerna vid omladdning; varje nytt
skyddat API-anrop kontrollerar ändå aktuell inställning. Redan hämtade eller
utskrivna handlingar kan inte återkallas. Ingen live-pollning ingår i steg ett.
Översiktsidentitet och kontaktuppgifter som behövs för projektet kvarstår.

## Verifiering

Domäntester täcker samtliga 32 kombinationer, oförändrade avtal och äldre
projekt. PGlite-tester täcker databasbehörighet, projektansvarig, samtidiga
revisioner, återförsök och oföränderlig historik. API-tester täcker kundroll,
återkallad länk, direktfiler och förhandsvisning utan skrivning. Kötester
täcker snabb ångring, sparfel, nytt projektansvar och nyare servervärden.
Webbläsartester använder bara fiktiva data och skickar inga mejl.
