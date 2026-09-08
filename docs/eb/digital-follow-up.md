# Digital åtgärdsuppföljning i EB

## Första versionen

- Tillval i det publika digitala utlåtandet, direkt under översta informationsrutan. Knappen heter **Köp åtgärdsuppföljning** och priset visas intill. Klicket öppnar information och verifiering, inte en direkt beställning.
- **599 kr inklusive moms per besiktning**, engångsköp. Netto 479,20 kr och moms 119,80 kr (25 %). Ingen prenumeration eller ny tjänstetidsgräns.
- Beställning mot faktura. Tjänsten aktiveras när beställningen sparats, inte först efter betalning.
- Systemet mejlar beställningsbekräftelse till kunden och fakturaunderlag till säljaren. **Det skapar inte en faktura eller bokför betalning**; fakturering hanteras manuellt.
- Beställaren fördelar noteringar och skickar personliga entreprenörslänkar. Entreprenören lämnar kommentarer och åtgärdsbilder och anmäler åtgärder.
- ”Anmält åtgärdat” är entreprenörens uppgift. Ingen besiktningsmans kontroll, godkännande eller efterbesiktning ingår.
- Bokning av efterbesiktning ingår inte i denna leverans.

## Avgränsning och åtkomst

Det kostnadsfria utlåtandet och dess PDF kräver inte beställning eller inloggning. Köpdelen laddas separat och får aldrig blockera rapportvisningen.

Beställning kräver en engångskod till registrerad beställaradress i entreprenaden eller accepterad uppdragsbekräftelse. Publika rapportlänken är inte tillräcklig behörighet för köp eller fakturering. Efter köp tillhör åtkomsten den verifierade köparen, även om projektets kontakt senare byts ut. Publika svar visar inte kundens registrerade e-post eller fakturauppgifter.

En unik order per besiktning, låsning i databasen och återanvändning av slutförd kodförfrågan skyddar mot dubbelbeställning. Nya beställningar görs endast från senaste publicerade rapportversionen. En redan beställd uppföljning behåller sitt ursprungliga underlag.

Besiktningsdatumet begränsar inte tillvalet: även äldre fastställda utlåtanden kan användas. Äldre rapportkopior kan sakna `inspection.reportLockedAt`, eftersom kopian tidigare skapades precis före låsningen. Då kontrolleras den verkliga låsningen för samma organisation/projekt/besiktning och att ingen upplåsning har skett sedan rapportkopians ursprungliga `createdAt`. Ett senare datum på en omskickad länk används inte som bevis. Saknad eller osäker historik stoppar nya köp; rapportens text ändras inte och en befintlig köpares verifierade åtkomst bevaras.

Köprutan visas för kunden endast när tjänsten går att köpa. Avstängd nyförsäljning, saknad konfiguration, olämpligt underlag eller en ersatt rapportversion döljer hela erbjudandet, inklusive pris och instruktioner. Tillfälliga tekniska fel visas diskret med **Försök igen**, utan ett köperbjudande. En redan beställd uppföljning behåller sin verifierade åtkomst även när nyförsäljningen är avstängd.

Driftstatus och orsaker till avstängning visas i den behörighetsskyddade interna digitala förhandsvisningen. Där förklaras också att själva köpet görs från kundens publika rapportlänk; inga köp eller nya länkar skapas automatiskt vid visning.

Noteringar och originalbilder kopieras från den fastställda rapporten. Originalbilder förvaras i den privata bucketen `eb-follow-up-originals`. Åtgärdsbilder, kommentarer och status är separata från utlåtandet och ändrar inte dess text eller PDF. Köpta uppföljningar, äldre portaler och olika besiktningar har separata kontakt-/uppgifts-/länkområden. Entreprenörer ser endast tilldelade uppgifter.

Personliga länkar har säkerhetsutgång enligt befintlig portalmodell (180 dagar), inte ett slutdatum för köpt tjänst. Ägaren kan begära förnyelse till sin verifierade adress; en gammal länks innehavare får inte en ny länk direkt. Ägarlänk ska aldrig skickas vidare till entreprenören.

Privatkunden får information om ångerrätt och kan använda **Ångra beställningen** i sin privata portal. Begäran tidsstämplas, kvitteras via mejl och pausar nya åtgärdssvar och fakturaunderlaget för manuell hantering. Ingen automatisk återbetalning, kreditering eller radering utförs. Detta ersätter inte säljarens bedömning av begäran.

## Driftsättning — måste göras före försäljning

1. Granska och applicera databasfilerna i ordning, efter tidigare EB-/åtgärdsportalmigreringar:
   - `docs/db/2026-09-07_07_eb_follow_up_orders.sql`
   - `docs/db/2026-09-07_08_eb_follow_up_remediation.sql`
   - `docs/db/2026-09-07_09_eb_follow_up_mail_cron.sql`
2. Publicera applikationskoden. Låt `EB_FOLLOW_UP_ENABLED` vara avstängd tills checklistan är klar. Befintliga köp kan fortfarande öppnas om nyförsäljningen stängs av.
3. Säkerställ säljaridentitet per organisation. I första hand används `organizations.eb_follow_up_seller` med `name`, `orgNumber`, `address`, `email` och valfritt `phone`. Saknade värden hämtas från organisationsskaparens företagsprofil. Tjänsten erbjuds inte om namn, organisationsnummer, adress eller e-post saknas. Kontrollera uttryckligen **vilket företag som säljer och fakturerar tjänsten**; dessa uppgifter visas för kunden och fryses med ordern. Administrativ redigeringsvy för denna konfiguration ingår inte ännu.
4. Kontrollera befintliga `APP_BASE_URL`, `RESEND_API_KEY`, `ASSIGNMENTS_MAIL_FROM`, `SUPABASE_SERVICE_ROLE_KEY` och `CRON_SECRET`. Produktionsbasadressen ska vara den rätta HTTPS-adressen. Lägg helst till en separat stark `EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY`; annars härleds krypteringen från service role-nyckeln. Koder och ägarlänkar lagras krypterat i mejlkön. **Rotera inte krypteringsnyckeln med väntande mejl eller aktiva kodförfrågningar utan en migreringsplan.**
5. Kontrollera Supabase `pg_cron`, `pg_net` och Vault. SQL09 återanvänder befintlig PDF-/uppföljningscron om den är konfigurerad. Alternativt används Vault-namnen `hushub_eb_follow_up_endpoint_url` (HTTPS-adress som slutar med `/api/cron/eb/follow-up`) och `hushub_eb_follow_up_cron_secret` (samma värde som serverns `CRON_SECRET`). Inga hemligheter ska läggas i Git eller SQL-filen.
6. Om SQL09 varnade om saknad konfiguration: konfigurera Vault och kör `select public.configure_eb_follow_up_mail_cron();`. Jobbet heter `hushub-eb-follow-up-mail-v1` och kör varje minut. Använd `select public.eb_follow_up_mail_cron_status();` för att kontrollera aktivt jobb och aktuell slutförd HTTP 200. Funktionen lämnar inte ut hemligheter. Enbart ett aktivt jobb bevisar inte fungerande mejlleverans.
7. Kontrollera slutliga köpvillkor, ångerhantering och manuella faktureringsrutiner med ansvarig säljare. Villkorsversion, pris, moms, samtycken, köpare och säljare sparas med beställningen. Informationen om digitala köp/ångerfunktion utgår från [Konsumentverkets informationskrav vid distansavtal](https://www.konsumentverket.se/marknadsratt-foretag/informationskrav-vid-distansavtal-regler-for-foretag/); implementationen är inte ett löfte om juridisk fullständighet.
8. Prova med särskild testbesiktning och kontrollerade testmottagare: köp, kodleverans, kvittens, fakturaunderlag, entreprenörsinbjudan, bild, svar, återöppning och ångerbegäran. Aktivera sedan `EB_FOLLOW_UP_ENABLED=true`.

## Automatisk mejlleverans

Order, inbjudningar och åtgärdshändelser läggs i en varaktig kö. Databaslås/lease hindrar parallella utskick av samma köpost. Avbrutna körningar kan återtas; misslyckanden försöks igen med ökande väntetid. Leverantörens idempotensnyckel skyddar mot dubletter. Koder som gått ut skickas inte. Efter uttömda försök blir posten `failed` och kräver operativ hantering — användaren ska inte behöva hålla rapporten öppen.

Övervaka `eb_follow_up_email_outbox` (behörig server/admin) för gamla väntande och misslyckade poster. Vanliga konfigurationsfel är avsändardomän, fel cronhemlighet eller ändrad krypteringsnyckel. Skriv aldrig ut krypterat innehåll, personliga länkar eller kunduppgifter i felsökningsloggar. Nycklar och verkliga utskick ingår inte i de lokala testerna.

Om en beställning avbryts efter bildkopiering men före aktivering kan privata, ännu oanvända kopior ligga kvar i `eb-follow-up-originals`. Automatisk rensning ingår inte; en eventuell senare rensningsrutin måste kontrollera orderreferenser och pågående beställningsförsök innan något tas bort. Befintliga originalbilder raderas eller skrivs aldrig över av kopieringen.

När en entreprenörslänk utfärdas på nytt återkallas föregående länk efter att det nya utskicket har köats. Det skyddar vid byte av kontakt, men mottagaren kan behöva invänta det nya mejlet. Köad leverans är inte samma sak som bekräftad leverans.

## Lokal verifiering

- `node --experimental-strip-types --test test/eb-follow-up-*.test.ts` — köp/behörighet, atomiska databasåtgärder, ursprungsrapportens integritet och cron.
- `node scripts/test-eb-follow-up-ui.mjs` — verklig köpdelskomponent med lokal simulerad API, 390/1440 px, tangentbord, dubbelklick, samtycken, felbevarande och återöppning utan nytt köp. Inga verkliga mejl, beställningar eller databasanrop.
- `node scripts/test-eb-follow-up-portal-ui.mjs` — rollspecifik portal med simulerade svar: tilldelning/inbjudan, ångerbegäran, åtgärdsrapportering, bilder och mobil layout.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`
- `npm run build`

Databastesterna använder isolerad PGlite, inte produktionsdatabasen. Schemaläggartestet ersätter nätanrop med en lokal tabell. Kompilerade UI-testfiler och skärmbilder ligger i ignorerade `tmp/eb-follow-up-ui/` och `tmp/eb-follow-up-portal-ui/`.
