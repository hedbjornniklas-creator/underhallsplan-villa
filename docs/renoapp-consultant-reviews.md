# Bestallning av konsultgranskning

## Drift

Kor hela `docs/db/2026-09-07_04_renoapp_consultant_reviews.sql` i Supabase innan koden driftsatts.
Migrationen forutsatter befintliga RenoApp-tabeller och kan koras igen.
Inga nya miljohemligheter behovs: befintliga `RESEND_API_KEY`, `ASSIGNMENTS_MAIL_FROM`
och `NEXT_PUBLIC_SITE_URL` anvands. Standarddestinationen ar `https://hushub.se`.

## Flode

- I styrelsens arende, omedelbart fore beslutet, finns "Fa hjalp av byggkonsult".
- Dialogen visar fast pris 1 500 kr exkl. moms, frivillig text och separat bekraftelse
  "Bestall granskning". Ingen betalning tas via kort i denna version.
- En bestallning per arende sparas med serverstyrt pris, bestallarens profil/namn/mejl,
  tidpunkt och meddelande. Det befintliga arendets status andras inte.
- Ett mejl skickas till `jn@hedbjorn.se` med HTML-knapp, textversion och Reply-To till bestallaren.
- Knappen oppnar `/renoapp/review/<case-id>`. Utloggade hamnar pa ordinarie inloggning
  och atervander sedan till samma arende. Ett UUID i lanken ger inte behorighet.
- Lasvyn och alla bilagor kraver `hushub_admin/renoapp_admin`, samt en sparad bestallning
  for arendet. Inget styrelsemedlemskap kravs for administratoren. Styrelsens vanliga
  API-behorigheter utokas inte. Fil-ID:n kontrolleras mot just det bestallda arendet.
- Lasvyn visar aktuella arendeuppgifter, alla sparade fragasvar, underlag, foretag,
  bilagor, accepterad regelversion, kompletteringar och beslut. Senast uppdaterad visas.
  Bestallning och pris ar historiska; materialet ar en levande lasvy, inte en fryst kopia.
- Ingen ny adminflik, konsultinloggning, offertfunktion, resultatuppladdning eller
  automatisk fakturering ingar. Uppfoljning och leverans hanteras manuellt tills vidare.

## Leverans och aterforsok

Bestallningen sparas fore utskick. Samtidiga bestallningar serialiseras i databasen
och far samma bestallnings-ID. Orderdata far inte skrivas om efterat.
En tva minuter lang utskickslease och en stabil Resend-idempotensnyckel skyddar
mot parallella utskick. Mejlinnehallet fryses vid bestallning sa samma nyckel aldrig
anvands med ett forandrat meddelande.

Vid fel/okand leverans visas sparad bestallning och "Forsok skicka mejlet igen".
Aterforsok ar aldrig en ny betalbestallning. Vid avbrott mitt i leverans kan leasen
behova lopa ut innan aterforsok skickar. Ingen automatisk bakgrundskorning ingar.
En godkand providerrespons betyder skickat, inte bevis pa att mejlet natt inkorgen.
Langt senare aterforsok efter providerns idempotensfonster kan ge en mejlkopia,
men bestallnings-ID och den enda bestallningen for arendet ar oforandrade.

## Verifiering

`npm run test:renoapp-reviews` testar SQL-migrationen i PGlite samt faktiska
service/API-funktioner med mockad databas och mejlprovider. Testerna skickar inga mejl.
`npm run test:renoapp-brf`, `npm run test:renoapp-completion` och
`npm run test:public-navigation` kontrollerar kringliggande floden.

Manuellt: oppna dialog, avbryt/Escape, bestall med tom text, kontrollera omladdning,
dubbelklick och fel/aterforsok. Kontrollera mobil och dator. I drift: bestall ett
testarende uttryckligen, oppna mejlknappen utloggad, logga in som HusHub-admin och
hamta bilagor. Kontrollera ocksa att ett konto utan adminbehorighet nekas atkomst.
