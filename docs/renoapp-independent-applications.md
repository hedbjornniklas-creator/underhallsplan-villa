# Självständiga ansökningar

## Beslut och omfattning

Varje ärende äger sökandens namn, mejl och telefon samt internt lägenhetsnummer
och Skatteverkets lägenhetsnummer. Uppgifterna lagras direkt på
`renovation_cases`. Inga ansökningar matchas ihop efter nummer, mejl eller telefon.
Numren sparas som text, så exempelvis inledande nollor bevaras.

`unit_id` och `applicant_contact_id` sätts till null vid ny ansökan och vid
sparande av grundutkast. Ansökningsflödet skriver inte till `brf_units`,
`unit_contacts` eller `contacts`. Dessa tabeller och separat registerkod tas
inte bort, men de används inte för ansökningsuppgifterna i ärendevyerna.
Personliga konton, styrelsemedlemskap och autentisering ändras inte.

Utkast, den sökandes ärendelänk, styrelsens lista och detaljvy läser ärendets
egna värden. Det finns ingen reservläsning från gamla gemensamma poster.
Kontaktuppgifter för utskick hämtas från ärendet respektive dess personliga
ärendelänk, inte från andra ansökningar. Filer, svar och beslut är fortsatt
knutna till ärendet. Ingen ny sökvy eller lägenhetshistorik byggs här.

Grunduppgifter kontrolleras vid första inskickning. En komplettering får inte
blockeras av ett saknat lägenhetsnummer i redan låsta grunduppgifter. Kontrollen
att sökanden inte ändrar grundansökan och kontroller av begärda svar och
företagsbekräftelser behålls.

## Driftsättning

1. Kör `docs/db/2026-09-29_02_renoapp_independent_applications.sql` före koddeploy.
   Den lägger till fem nullable textkolumner och kan köras igen. Befintliga RLS-
   regler för ärenden behålls. Inga tabeller eller ärenden raderas.
2. Publicera koden. Kör inte äldre kod parallellt när nya testansökningar börjar
   skapas: den äldre koden läser inte de nya fälten.
3. Pavlina börjar en ny ansökan via föreningens ansökningslänk utan `draft`.
   Använd ett fiktivt nummer för testet, exempelvis 1101. Inget verkligt nummer
   ska gissas. Den gamla testansökan ligger kvar men används inte som källa.

Ingen backfill eller rättning av äldre ärenden ingår enligt produktbeslutet.
Äldre testärenden kan därför visa tomma sökande- och lägenhetsfält efter deploy.
De ska inte användas för att verifiera det nya flödet. Ingen produktions-SQL
eller publicering är utförd enbart genom att denna fil finns i repot.

## Verifiering

- Spara med tomt Skatteverksnummer, fyll sedan i och korrigera numret.
  Läs tillbaka via både utkast- och ärendelänk.
- Skapa flera ansökningar med identiska nummer och kontaktuppgifter; ändra en.
  Övriga ärenden, ärendenummer och kontaktuppgifter ska förbli oförändrade.
- Läs lista och detaljvy utan åtkomst till gemensamma kontakter/lägenheter.
- Kontrollera att skrivfel returnerar fel, inte en lyckad sparbekräftelse.
- Kontrollera fortsatt krav på nummer vid första inskickning, men inte som
  ny spärr vid komplettering. Grunduppgifter ska fortfarande vara låsta.
- Testa SQL i PGlite, inklusive upprepad migration och dubbla nummer.

## Avgränsningar

Ingen generell registerfunktion, historisk återställning, gallringsfunktion
eller ändring av nummerformat/obligatoriska fält ingår. Kontaktkolumnerna kan
hanteras separat från sakuppgifter, men en framtida gallring måste även omfatta
personliga länkar, meddelanden, dokument och andra personuppgiftskällor.
