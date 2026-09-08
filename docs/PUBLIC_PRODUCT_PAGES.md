# Publika produktsidor

## Sidstruktur

- `/` är ingången till BesiktApp, RenoApp och den boendes ansökan.
- `/besiktapp` förklarar besiktningsarbetet och länkar till `/besiktapp/intresse`.
- `/renoapp` förklarar ansökan och styrelsens granskning. Befintlig ansökan, BRF-intresse och inloggning behåller sina adresser.
- `/om-hushub` visar bolaget bakom tjänsten. Namn och organisationsnummer visas också i den gemensamma publika sidfoten. Säte är utelämnat enligt användarens önskemål. Källor och avgränsningar beskrivs i `docs/PUBLIC_COMPANY_INFO.md`.
- `PublicProductIntro` återanvänder introduktion, produktlogotyp, intresselänk och befintlig inloggningsväg. Exemplen på produktsidorna har fiktiva uppgifter och är inte skärmbilder.
- Inloggade arbetsflöden, behörigheter, databas och driftupplägg har inte byggts om. Gemensamma mejlsändaren har ett valfritt idempotenshuvud och timeouten omfattar nu även läsning av leverantörens svarskropp.

## Lägg till priser senare

De valfria kommersiella pris- och kontaktsektionerna styrs i `src/lib/publicCommercialContent.ts`. Bolagsidentitet och bekräftad offentlig företagskontakt finns separat i `src/lib/publicCompanyInfo.ts` och får inte döljas av kampanjinställningar.

1. Fyll i `pricing.besiktapp.content` eller `pricing.renoapp.content`: rubrik, introduktion, planer med pristext, debiteringsperiod och vad som ingår, samt moms-/prisnotering.
2. Sätt just den produktens `enabled` till `true` när innehållet är beslutat.
3. Produktsidan visar då den gemensamma `PublicPricingSection` före vanliga frågor, och introduktionen får länken ”Se priser”. Sidans struktur behöver inte ändras. Varje produkt kan publiceras oberoende.

Belopp och villkor är medvetet inte ifyllda. Tomma/ofullständiga sektioner visas inte. Komponenten stödjer en eller flera planer, inte köp, abonnemangshantering eller betalning. Sådana nya arbetsflöden är ett separat beslut.

## Lägg till en större kontaktsektion senare

Fyll i `contact.content` (rubrik, introduktion, företagsnamn och minst e-post eller telefon; adress är valfri) och sätt `enabled: true`. Hämta bolagsnamn och eventuell gemensam företagskontakt från `PUBLIC_COMPANY_INFO` för att undvika motstridiga uppgifter. `PublicFrame` visar då en större kontaktsektion, och meny/sidfot får ankarlänkar till den. Den sektionen är fortfarande avstängd. Företagsinformationen i sidfoten och på `/om-hushub` visas däremot alltid.

Denna fil är **publikt innehåll**, inte en hemlighets- eller utkastförvaring. En avstängd sektion är dold i gränssnittet men innehåll i klientkod kan ändå finnas i JS-paket. Lägg därför aldrig privata kontaktadresser eller andra hemligheter i filen. Ändringarna publiceras genom projektets vanliga bygg-/deployflöde, inte ett nytt CMS.

## BesiktApps intresseformulär

Formuläret skickar ett mejl till en uttryckligen konfigurerad intern mottagare. Det skapar inte ett konto, en BRF eller en automatisk bekräftelse till den sökande. Med `BESIKTAPP_INTEREST_TRACKING=1` sparas förfrågan dessutom före mejlutskicket i en separat, adminskyddad intresselista. Funktionen är av som standard och kräver granskad migration och driftaktivering; se `docs/BESIKTAPP_ONBOARDING.md`.

Serverinställningar som krävs före aktivering:

| Variabel | Innehåll |
| --- | --- |
| `BESIKTAPP_INTEREST_TO` | En intern mottagaradress, endast e-postadressen. Ingen BRF-fallback. |
| `ASSIGNMENTS_MAIL_FROM` | Befintlig verifierad avsändare hos mejlleverantören. |
| `RESEND_API_KEY` | Befintlig privat mejlnyckel. |

Mottagaren är oberoende av framtida **offentliga** kontaktuppgifter. Utan giltig konfiguration visar intressesidan ett tydligt besked om att formuläret är tillfälligt stängt. API:t ger då 503 och försöker inte skicka. Inga privata värden skickas till webbläsaren.

### Leverans och begränsningar

- Utan intresselistan visas framgång först när mejlleverantören accepterat begäran och returnerat ett meddelande-id. Det är inte bevis på leverans till eller läsning i inkorgen. Mejlet är då det enda sparade underlaget.
- Med intresselistan aktiverad räcker en säkert sparad förfrågan för framgång även om mejlaviseringen misslyckas. Misslyckad/obekräftad avisering visas i adminlistan. Vid databasfel sparas inget via reservväg och inget mejl skickas: besökaren får ett fel och kan använda den offentliga kontaktadressen.
- Bevaka leveranser, studsar och skräppost hos leverantören/mottagaren. Databasläget ersätter inte leveranskontroll eller bemannad uppföljning.
- Vid nätverksfel behåller formuläret uppgifterna i den öppna sidan. Omladdning stänger sessionen; personuppgifter lagras inte lokalt i webbläsaren.
- Ett submissions-id behålls vid återförsök; stabilt innehåll ger samma leverantörsnyckel. Idempotens gäller inom Resends 24-timmarsfönster. Ändrat innehåll eller omladdad sida är en ny logisk sändning. Se [Resends dokumentation om idempotens](https://resend.com/docs/dashboard/emails/idempotency-keys).
- API:t kräver same-origin JSON, begränsar faktisk kropp till 16 KiB, validerar fälttyper och längder, escapear HTML och använder en honeypot. Avsändare, mottagare och ämnesrad kommer inte från fri användartext.
- En begränsad lokal räknare bromsar till fem försök per klient och trettio totalt på tio minuter. Den är **best effort per serverinstans**, inte ett distribuerat spamskydd. På Vercel används dess plattformssatta IP-header; annars delar klienterna en lokal räknare. Inför större publik kampanj behövs en separat edge/WAF-regel eller beständig limiter. Origin-kontroll stoppar inte egna botklienter.
- Granska personuppgiftshantering, gallring och framtida publicerad integritetsinformation inför lansering. Den korta formulärtexten ersätter inte en fullständig integritetspolicy.

## Verifiering

`npm run test:public-products` testar pris-/kontaktsektionerna av/på, appdestinationer, validering, mejlinnehåll, idempotensnycklar, felhantering och begränsning av anrop. Leveransen är mockad: testerna skickar inga riktiga mejl eller produktionsansökningar.

Komplettera med typkontroll, ESLint för ändrade filer och produktionsbygge. Manuell browser-QA och ett uttryckligen godkänt leveransprov efter driftkonfiguration är separata kontroller; unit-testerna bevisar inte dem.
