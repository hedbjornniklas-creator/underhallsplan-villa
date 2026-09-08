# BesiktApp: start för nya användare

## Första etappen, 2026-09-08

Arbetsmodellen är kontaktbaserad start. En intresseanmälan skapar inte konto eller behörighet. Vi lovar ingen provperiod, svarstid, demonstration eller automatisk aktivering. Pris och kommersiella villkor är ännu inte publicerade.

Kodändringar i etapp A:

- BesiktApps startsida, produktsida, intressesida och inloggning hänvisar till kontakt, inte till ett overifierat företagsinbjudningsflöde. RenoApps inbjudningar påverkas inte.
- `PUBLIC_BESIKTAPP_CONTACT_EMAIL` är en uttryckligen godkänd offentlig reservväg: `jn@hedbjorn.se`. Den visas vid formuläret och när formuläret är avstängt. Den är separat från intern mejlkonfiguration och bolagets allmänna kontaktfält.
- ÖB-visitkortet visar endast profilens egna uppgifter. Tomma eller ofullständiga profiler får en uppmaning att komplettera och en synlig länk till profilinställningarna.
- Globala TU-utskriftsmarginaler innehåller inte längre ett fast företagsnamn eller en persons kontaktuppgifter. Rapporternas egna databaserade identitetsuppgifter ändras inte.

## Driftkontroll som återstår före formulärlansering

Lokal kontroll visar att mottagare, avsändare och Resend-nyckel finns, men att avsändaren använder Resends testdomän. Detta bevisar inte fungerande leverans. Produktionsvärden har inte kunnat verifieras från den lokala miljön: ingen Vercel-CLI, projektkoppling eller tillgänglig Vercel-token hittades.

1. Öppna rätt HusHub-projekt i befintlig Vercel-miljö.
2. Kontrollera `BESIKTAPP_INTEREST_TO`, `ASSIGNMENTS_MAIL_FROM` och `RESEND_API_KEY` för Production. Ändra inte den gemensamma avsändaren utan att bedöma påverkan på övriga utskick.
3. Kontrollera verifierad avsändardomän och mottagarbegränsningar hos Resend. Flytta inte nycklar eller privata driftvärden till publik kod.
4. Publicera genom projektets ordinarie flöde. Kontrollera att formuläret visas på `/besiktapp/intresse`.
5. Genomför ett uttryckligen godkänt leveransprov med testdata till rätt mottagare. Bekräfta både leverantörsstatus och mottagen post. Ett accepterat API-anrop räcker inte.
6. Kontrollera svarsfunktionen, studsar, skräppost och vem som bevakar inkorgen.

Ingen produktionsändring, riktig intresseanmälan, kontoskapande eller mejlsändning utförs av komponenttesterna. Reservlänken fungerar efter publicering även om formuläret ännu är stängt.

## Fortsatt genomförande

- Etapp B: kort startbeskrivning på produktsidan, uppföljningsbar förfrågan och ett verifierat inbjudnings-/aktiveringsflöde. Kartlägg befintlig autentisering och företagskoppling först. Användare i olika företag får aldrig sammanblandas.
- Etapp C: återupptagbar profilintroduktion och första uppdraget. Direktstart för användare med endast ÖB; tydligt val för flera tillgängliga arbetsområden.
- Etapp D: användartest och kontrollerad lansering. Testa nya och befintliga konton, begränsade behörigheter, utgångna/återkallade länkar och misslyckade mejl.

## Verifiering av etapp A

`npm run test:public-products` innehåller renderingskontroller för tom, partiell och fullständig profil, meriter, escapad användartext samt offentlig kontakt utan läckage av privata mottagarinställningar. Befintliga tester täcker validering, mejlfel och återförsök med mockad leverans. Komplettera med typkontroll och browserkontroll av de publika sidorna.

Kontroll 2026-09-08: 26/26 tester passerade, riktad ESLint passerade och intressesidan samt BesiktApps inloggningshjälp kontrollerades i lokal webbläsare. Projektets fullständiga typkontroll stoppade i parallellt ändrade `src/components/eb/EbFollowUpOrder.tsx:151` (`retryable` saknas på `EbFollowUpOffer`); det felet ändrades inte inom etapp A. Det stängda formulärets reservkontakt och profilens olika tillstånd verifierades genom komponentrendering, inte genom ett nytt produktionskonto. Ingen ny PDF-export eller riktig mejlleverans genomfördes.
