# Sök i hela HusHub

Startsidan `/dashboard-v1` har ett kompakt sökfält i sidhuvudet. Sökningen
visar grupperade träffar med modul, innehållstyp, adress/fastighetsbeteckning
och status. En träff öppnar den befintliga skyddade sidan för innehållet.
Sökningen ändrar inte arbetsdagens kalender, karta eller att göra-lista.

## Innehåll och behörighet

| Arbetsområde | Sökbara poster och metadata | Åtkomst |
| --- | --- | --- |
| ÖB | Besiktningar, befintliga utlåtanden och uppdragsbekräftelser; beteckning, adress, kund och uppdragsnummer | Organisationens ÖB-behörighet samt samma ägar-/kollegiekontroll som vid öppning av besiktningen |
| TU | Tekniska utredningar, befintliga utlåtanden och uppdragsbekräftelser | TU-behörighet och vald organisation |
| EB | Projekt och besiktningar med uppgift om utlåtande | EB-behörighet och vald organisation |
| Fuktsäkerhet | Projekt | Modulbehörighet och vald organisation |
| Gizmo | Projekt samt läsbara uppgifter | Modulbehörighet, organisation och befintlig användar-RLS |
| RenoApp | Ärenden i användarens behöriga föreningar, inklusive fastighetsbeteckning | Separat RenoApp-behörighet och uttryckligen behöriga BRF:er |
| Fastigheter | Användarens fastighetsregister | Befintlig ägaråtkomst |
| Kunder | Namn, kundnummer och adress | Kundregistrets organisationsbehörighet; personnummer ingår inte |

Även avslutade poster kan hittas när deras befintliga destinationssida går att
öppna. Arkiverade Gizmo-uppgifter saknar sådan läsbar destination och tas inte med.
RenoApp visar inga publika åtkomsttoken eller sökandens privata kontaktuppgifter.
Sökningen gäller registrerade metadata; den läser inte textinnehållet i
uppladdade PDF-filer, bilagor eller dokument.

Startsidan använder för närvarande standardorganisationen. Andra organisationer
öppnas genom arbetsområdenas befintliga organisationsval. Sök-API:t avvisar en
organisation vars destinationssidor annars skulle öppnas i fel organisation.

## Beteende och drift

- Minst två tecken, högst 200. Blanksteg normaliseras. Matchning hanterar
  svenska diakritiska tecken och vanliga skillnader i beteckningars skiljetecken.
- Högst åtta träffar per modul och 40 totalt. Gränssnittet ber användaren förfina
  sökningen när fler träffar finns. En fastighets exakta beteckning prioriteras.
- Fördröjd start vid inmatning och avbrutna äldre sökningar minskar onödiga anrop.
  Delvisa fel visas som delresultat, inte som ett fullständigt tomt resultat.
- `/api/hushub/search?q=…&orgId=…` är en autentiserad, läsande serverroute med
  `private, no-store`. Klienten sparar inga träffar i lokal lagring.
- Utgången session erbjuder ny inloggning med återgång till aktuell sida.
  Organisations- eller identitetsbyte rensar tidigare träffar.
- Inga databasmigreringar, nya rättigheter eller externa sökindex behövs.

## Verifiering

`npm run test:global-search` kör sökmodell, kandidatläsning, modulernas
behörighetskontroller och klientens asynkrona tillstånd med syntetiska poster.
Den befintliga dashboard-fixturen används även för kontroll av dator-/mobilvy,
tangentbordsval, tomt resultat, delresultat, återförsök och återinloggning.
