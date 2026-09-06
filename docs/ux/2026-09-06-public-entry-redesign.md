# HusHub – publika ingångar, 6 september 2026

## Genomförd inriktning

HusHub är huvudvarumärket. BesiktApp är besiktningsföretagens verktyg för uppdrag och utlåtanden. RenoApp är den befintliga tjänsten för boendes renoveringsansökningar och styrelsens handläggning.

Den framtida fastighetshubben och underhållsplanen marknadsförs inte som färdiga funktioner. Inga nya domäner, prisuppgifter eller kundpåståenden har lagts till.

Startsidan ger tre riktiga vägar: boende, styrelse och besiktningsföretag. Nya besökare kan läsa om produkterna direkt från huvudsektionen. Föreningar som vill börja använda RenoApp har en separat informations- och intresseväg.

## Produktfält och inloggning

Originalbilderna i public/landing används. HusHub är störst; produktlogotyperna är mindre och klickbara. Produktdestinationerna finns i src/lib/publicNavigation.ts.

| Ingång | Utloggad | Inloggad |
| --- | --- | --- |
| HusHub-logotyp | / | / |
| BesiktApp | /login?next=%2Fdashboard-v1 | /dashboard-v1 |
| RenoApp för styrelsen | /renoapp/login?next=%2Frenoapp%2Fapp | /renoapp/app |
| Kontoknapp | /login, ”Logga in” | /app, ”Öppna HusHub” |
| Boende | /renoapp/apply, inget konto | Samma ansökningssida |

Sessionsinformationen används endast för länkarnas presentation. Befintliga serverkontroller avgör fortfarande tillgången till apparna. Produktlänkar och inloggningslänkar förladdas inte.

Den generella inloggningens tidigare tillåtna destinationer är oförändrade: /dashboard-v1, /renoapp/app och /mina-uppdrag. Andra värden går till /app. Formulärets rubrik följer nu det valda målet även när man kommer direkt via en produktlänk. RenoApps befintliga kontroll av nästa destination och återställningsflödet för lösenord är bevarade.

## Ändrade sidor

- src/app/(app)/page.tsx: kortare startsida med uppgiftsbaserade genvägar, konkreta produktbeskrivningar och FAQ. Dekorativa ”Välj rätt arbetsflöde” och texter om gemensam autentisering borttagna.
- src/app/(app)/layout.tsx: omslutande main ersatt av div för startsidan/embed, så startsidan inte har nästlade main-element. Övrig layoutlogik oförändrad.
- src/app/(auth)/login/page.tsx: läser sökparametrar på servern och visar den återanvända inloggningen utan försäljningspanel.
- src/app/renoapp/page.tsx: information för nya föreningar, tydlig styrelseingång och separat väg för boende.
- src/app/renoapp/apply/page.tsx: föreningssökning direkt på sidan; laddning, inga träffar och fel med möjlighet att försöka igen.
- src/app/renoapp/login/page.tsx: inloggningsformuläret först, med hjälp för den som saknar konto och en direktlänk för boende.
- src/app/renoapp/request-access/page.tsx: tydligt intresseformulär med bestående fältetiketter, obligatoriska fält enligt API:ets krav och begriplig bekräftelse. Fokus flyttas till bekräftelsen efter lyckad anmälan.
- src/components/renoapp/RenoAppHeader.tsx: det gamla sidhuvudet döljs enbart på de fyra publika RenoApp-ingångarna. Privat navigation lämnas intakt.

## Gemensamma komponenter

- src/components/public/PublicFrame.tsx: sidhuvud, main och sidfot.
- src/components/public/PublicHeader.tsx: produktfält, kontoknapp och navigation.
- src/components/public/PublicSession.tsx: sessionsstatus för länkarnas presentation.
- src/components/public/PublicLogin.tsx: kompakt presentation kring befintliga PasswordAuthPanel och bevarad redirectlogik.
- src/components/public/HomeRecoveryRedirect.tsx: bevarar startsidans lösenordsåterställningshantering.
- src/components/public/PublicFaq.tsx: native details/summary.
- src/components/public/public.css: avgränsade publika stilar, utan ändringar i rapporternas eller interna vyers stilar.
- src/lib/publicNavigation.ts: kanoniska produktmål och inloggningens befintliga destinationslista.
- test/public-navigation.test.ts samt package.json: fyra regressionstester via npm run test:public-navigation.

## Mobil och tillgänglighet

Mobilens första rad innehåller HusHub, kontoknapp och menyknapp. Produktlänkarna ligger på en egen synlig rad. Inga produktval är gömda längst ned i menyn.

Mobilmenyn använder dialog med modal beteende, tydlig stängknapp, Escape, fokusåterställning och låst bakgrundsscroll. Länkar och formulär har synligt tangentbordsfokus. FAQ använder webbläsarens inbyggda utfällning. Förstorad text får brytas och innehållet kan växa på höjden. Reducerad rörelse respekteras.

## Verifiering

- npx tsc --noEmit: godkänd.
- Riktad ESLint på nya komponenter, navigationskod, tester och ombyggda sidor: godkänd.
- Kontroll även av den ändrade applayouten hittar ett redan befintligt react-hooks/set-state-in-effect-fel på rad 14. Den raden är oförändrad från HEAD; den har inte åtgärdats i denna uppgift.
- npm run test:public-navigation: 4 godkända tester.
- npm run test:renoapp-navigation: 5 godkända tester.
- npm run test:renoapp-brf: 20 godkända tester.
- npm run build: godkänd.
- git diff --check: godkänd.

Startsidan granskades visuellt och mättes vid 375, 768, 1024 och 1440 px utan horisontell scroll. Samtliga ombyggda ingångssidor kontrollerades i mobilbredd; produktinformation och formulär granskades även på desktop. En bredare automatiserad browserloop gav osäkra viewportvärden och räknas inte som verifiering av varje undersida i alla storlekar.

Startsidan och mobilmenyn kontrollerades med dubblerad grundtextstorlek (32 px) vid 375 px; startsidan också vid 768 px. Två upptäckta radbrytningsproblem rättades. Den tillfälliga textstorleksinställningen är borttagen.

Webbläsarkontroller omfattade produktlänkar till respektive inloggning, byte från produktspecifik till generell inloggning, mobilmenyns länk till föreningsinformationen, Escape/fokus/scrollåsning, produktankare med tangentbord, föreningssökning med träffar och utan träffar samt intresseformulärets tomfältsvalidering. Skärmbilder visades under arbetet.

## Avgränsningar inför publicering

Ingen publicering eller push har gjorts. Resultatet finns lokalt och kan förhandsvisas på http://localhost:3000.

Inget verkligt konto användes för att testa en lyckad inloggning. Slutlig återgång efter autentisering och behörighetsstyrning granskades i kod och regressionstester, men bör också kontrolleras med ett testkonto inför publicering.

Inga renoveringsansökningar, utkast eller intresseanmälningar skickades under webbläsarkontrollen. Inget mejl skickades och ingen kunddata ändrades. API-fel och lyckad formulärbekräftelse granskades i kod, men provocerades inte fram mot den anslutna tjänsten.

Databas, RLS, konton, privata besiktningsflöden, rapporttexter, juridiskt innehåll, metadata och befintlig deployment är bevarade. Den publika föreningssökningen visar API:ets befintliga lista, inklusive eventuella testföreningar; listan har inte manipulerats som del av UX-ändringen.
