# Digital åtgärdsuppföljning i EB

## Första versionen

- Utlåtandet levereras enligt sändningslistan, oberoende av köp. Varje mottagare får **en knapp, Öppna utlåtandet**: beställaren får en personlig rapportlänk, övriga får den vanliga läslänken. Samma frysta rapport och PDF används. Ingen engångskod eller inloggning krävs och att öppna länken gör ingen beställning.
- Beställarens rapport visar köpboxen under rapporthuvudet med **Köp åtgärdsuppföljning – 599 kr inkl. moms**. Kassan öppnas först efter klick. Den vanliga läsvyn visar varken köpbox eller ”För beställaren”, även om samma webbläsare har en beställarsession.
- **599 kr inklusive moms per besiktning**, engångsköp. Netto 479,20 kr och moms 119,80 kr (25 %). Ingen prenumeration eller ny tjänstetidsgräns.
- Beställning mot faktura. Tjänsten aktiveras när beställningen sparats, inte först efter betalning.
- Systemet mejlar en separat beställningsbekräftelse till kunden och fakturaunderlag till **Admin, jn@hedbjorn.se**. Underlaget innehåller ordernummer, beställningstid, besiktning/objekt, köpare, fakturaadress, organisationsnummer om angivet, kontaktadress, säljare, pris, netto och moms. **Det skapar inte en faktura eller bokför betalning**; ingen koppling till faktureringssystem används. Admin meddelas även om kunden begär att frånträda köpet, så att manuell fakturering kan pausas.
- Beställaren fördelar noteringar och skickar personliga entreprenörslänkar. Entreprenören lämnar kommentarer och åtgärdsbilder och anmäler åtgärder.
- ”Anmält åtgärdat” är entreprenörens uppgift. Ingen besiktningsmans kontroll, godkännande eller efterbesiktning ingår.
- Bokning av efterbesiktning ingår inte i denna leverans.

## Avgränsning och åtkomst

Det kostnadsfria utlåtandet och dess PDF kräver inte beställning eller inloggning. Köpdelen laddas separat och får aldrig blockera rapportvisningen.

Beställning kräver en separat personlig länk som bara skickas till **en beställarkontakt per besiktning**. I **Fastställ och leverera** heter adressfältet **Beställare – huvudmottagare**. Vid första leveransen sparas den uttryckligen angivna adressen automatiskt för besiktningen, även utan uppdragsbekräftelse. Besiktningsmannen anger bara rätt beställare och övriga mottagare; det finns ingen separat inställning för att tillåta köp av extratjänsten. Att fastställa utan att skicka registrerar inte en ny beställare.

Förifyllning prioriterar en befintlig köpare, redan sparad beställarkontakt, aktuell godkänd uppdragsbekräftelse (accepted_at och status ordered/booked/completed, eller äldre accepted), och slutligen entreprenadens beställaradress. Finns ingen känd kundadress lämnas fältet tomt. **Den första personen i sändlistan används aldrig som reserv**, eftersom det kan vara entreprenören. Uppdragsbekräftelse krävs inte för leverans eller köp. Förifyllning från entreprenaden är endast ett förslag fram till leveransen; fakturaadress, närvaro och plats i sändlistan ger ingen köprätt.

En sparad beställaradress återanvänds och är skrivskyddad vid omsändning. Andra personer läggs i **Övriga mottagare**, inte genom ett tyst byte av beställare. Före köp kan en felaktig adress rättas uttryckligen via **Ändra beställaradress**; bekräftelsen gäller rätt kundidentitet, inte ett försäljningsbeslut. Efter köp tillhör åtkomsten den frysta köparen. För äldre leveranser utan sparad kontakt behålls tidigare säker verifiering från godkänd uppdragsbekräftelse; nästa uttryckliga leverans kan registrera beställaren utan att utlåtandet återskapas. Gamla godtyckliga sändlistor bakåtfylls inte som köpare.

Publika rapportlänken är inte tillräcklig behörighet för köp eller fakturering. En separat kryptografiskt slumpad beställarlänk lagras hashad i `eb_follow_up_customer_links`; rapporttoken lagras krypterad. Länken kontrolleras mot aktuell/fryst kund, organisation, projekt, besiktning, rapportversion, återkallelse och utgång. Beställarens rapportadress är `/rapport/bestallare/[token]`. Den privata köpendpointen validerar länken inför varje anrop och förnyar vid behov den 15 minuter långa sessionen från den fortfarande giltiga personliga länken. Kunden behöver inte begära ett nytt mejl efter att ha läst rapporten en stund. Inget kodmejl skickas och förnyelsen gör inget köp. Både server och databas återkontrollerar länken vid köp. Den gamla publika köpendpointen visar aldrig erbjudande och tillåter inte köp/portalåtkomst ens med en befintlig kundcookie; gamla mejl med `/api/eb/customer/[token]` öppnar i stället den privata rapportvyn.

Utlåtandets mejl innehåller ingen extra knapp för **Hantera din besiktning**. Endast den utsedda beställarens enda rapportknapp använder den privata länken; övriga mottagare får läslänken. **Dela utlåtande**, PDF och dokumentlänkar använder alltid rena publika rapportadresser, aldrig beställarens hemlighet eller privata portallänk. Vanlig delning är kostnadsfri. Befintliga läslänkar fortsätter fungera; ingen automatisk omsändning görs. Vid omsändning väljs rätt länk för respektive mottagare. Länkinnehavaren kan agera som beställaren: vidarebefordra därför aldrig den privata länken. Privata sidor har `no-referrer`, `no-store` och `noindex`. Om endast beställarlänken gått ut visas fortfarande den aktiva rapporten i läsläge med instruktion att kontakta besiktningsmannen för en ny personlig länk. Återkallade länkar ger inte denna reservåtkomst.

En unik order per besiktning, låsning i databasen och återanvändning av slutfört auktorisationsförsök skyddar mot dubbelbeställning. Nya beställningar görs endast från senaste publicerade rapportversionen. En redan beställd uppföljning behåller sitt ursprungliga underlag.

Besiktningsdatumet begränsar inte tillvalet: även äldre fastställda utlåtanden kan användas. Äldre rapportkopior kan sakna `inspection.reportLockedAt`, eftersom kopian tidigare skapades precis före låsningen. Då kontrolleras den verkliga låsningen för samma organisation/projekt/besiktning och att ingen upplåsning har skett sedan rapportkopians ursprungliga `createdAt`. Ett senare datum på en omskickad länk används inte som bevis. Saknad eller osäker historik stoppar nya köp; rapportens text ändras inte och en befintlig köpares verifierade åtkomst bevaras.

Köprutan visas för kunden endast när tjänsten går att köpa. Avstängd nyförsäljning, saknad konfiguration, olämpligt underlag eller en ersatt rapportversion döljer hela erbjudandet, inklusive pris och instruktioner. Tillfälliga tekniska fel visas diskret med **Försök igen**, utan ett köperbjudande. En redan beställd uppföljning behåller sin verifierade åtkomst även när nyförsäljningen är avstängd.

Den interna digitala förhandsvisningen visar en neutral förhandsvisningsnotis och en diskret länk för att rätta beställaradressen. Externa besiktningsmän får inga säljinställningar, prisbesked eller uppmaningar att aktivera extratjänsten. Köpet görs från beställarens personliga rapportlänk; inga köp eller entreprenörsinbjudningar skapas automatiskt vid visning. Saknade kunddatabasmigreringar får stoppa leveranssteget med ett tydligt återförsöksmeddelande, men får inte göra befintlig PDF/status eller fastställande beroende av försäljning.

Noteringar och originalbilder kopieras från den fastställda rapporten. Originalbilder förvaras i den privata bucketen `eb-follow-up-originals`. Åtgärdsbilder, kommentarer och status är separata från utlåtandet och ändrar inte dess text eller PDF. Köpta uppföljningar, äldre portaler och olika besiktningar har separata kontakt-/uppgifts-/länkområden. Entreprenörer ser endast tilldelade uppgifter.

Personliga länkar har säkerhetsutgång enligt befintlig portalmodell (180 dagar), inte ett slutdatum för köpt tjänst. Den separata ägarlänkens innehavare får öppna sin portal utan extra mejlkod; servern kontrollerar alltid länken och dess frysta köpare/ordermatchning. Återkallade, utgångna eller felaktigt avgränsade länkar ger ingen åtkomst. Ägaren kan begära förnyelse till sin registrerade adress; en gammal länks innehavare får inte en ny länk direkt. Entreprenören har en egen separat länk med åtkomst endast till tilldelade uppgifter.

Privatkunden får information om ångerrätt och kan använda **Ångra beställningen** i sin privata portal. Begäran tidsstämplas, kvitteras via mejl och pausar nya åtgärdssvar och fakturaunderlaget för manuell hantering. Ingen automatisk återbetalning, kreditering eller radering utförs. Detta ersätter inte säljarens bedömning av begäran.

## Godkännande och ångerinformation (villkorsversion 2026-09-08.2)

Kassan återanvänder uppdragsbekräftelsens mönster: välj uttryckligen privatkund eller företag/förening och godkänn omfattning/villkor samt betalningsskyldighet. Privatkunden bekräftar separat mottagen ångerinformation och begär uttryckligen att tjänsten börjar tillhandahållas innan ångerfristen löpt ut. Inga rutor är förvalda; byte av kundtyp nollställer samtyckena. Företagsköp tilldelas inte konsumentens lagstadgade ångerrätt.

`followUpTerms.ts` är gemensam källa för villkor och samtyckestexter i kassan och bekräftelsen. Servern ignorerar kundskickad bevistext och fryser fullständig text, SHA-256, version, kundtyp, samtycken, godkännandetid och beräknad sista ångerdag i `buyer_snapshot.acceptanceSnapshot`. Databasens `accepted_at` sätts till samma servergenererade tid; befintligt ändringsskydd gör uppgifterna oföränderliga. Gamla beställningar uppdateras inte retroaktivt.

Privatkundens ordinarie frist beräknas som 14 kalenderdagar från svensk avtalsdag, med förlängning när sista dagen är helg/fridag enligt lagstadgad tidsberäkning. Datumen styr information, inte automatisk avvisning av en senare begäran. Beräkningen förutsätter att föreskriven information lämnats; bristande information kan påverka den verkliga fristen. Direkt aktivering är inte i sig ett bortfall av ångerrätten eller ett fullgörande av hela tjänsten.

Bekräftelsemejlet innehåller hela den godkända texten, samtyckena, tidpunkt, beställningsnummer, fakturauppgifter och sista beräknade ångerdag. Där finns en klickbar direktlänk till `#angra-bestallning` i den personliga portalen och en länk till [Konsumentverkets ångerblankett](https://publikationer.konsumentverket.se/mallar-och-blanketter/angerblankett). En tjänsteanpassad blankett finns också som text i kassan och mejlet, så informationen inte enbart beror på en extern länk. Ingen ny PDF-generator införs; mejlets fullständiga text är den beständiga kopian.

Ångerfunktionen visar beställarens namn, beställningsnummer och registrerade mottagaradress innan kunden uttryckligen bekräftar. Servern kräver `confirmed: true`. Befintlig atomisk registrering, fakturapaus och hållbar mejlkö används fortsatt. Kvittensen innehåller identitet, beställning och mottagningstid; den är inte ett automatiskt beslut om återbetalning. Admin får beräknad sista ångerdag i fakturaunderlaget och meddelas vid frånträdande. Fakturering, proportionell ersättning och eventuell återbetalning hanteras fortfarande manuellt.

Underlaget för ångerinformationen är [distansavtalslagen](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-200559-om-distansavtal-och-avtal-utanfor_sfs-2005-59/) och Konsumentverkets informationskrav. Slutliga kommersiella villkor och faktisk hantering ska granskas av ansvarig säljare; detta är inte ett intyg om juridisk fullständighet.

## Driftsättning — måste göras före försäljning

1. Granska och applicera databasfilerna i ordning, efter tidigare EB-/åtgärdsportalmigreringar:
   - `docs/db/2026-09-07_07_eb_follow_up_orders.sql`
   - `docs/db/2026-09-07_08_eb_follow_up_remediation.sql`
   - `docs/db/2026-09-07_09_eb_follow_up_mail_cron.sql`
   - `docs/db/2026-09-08_01_eb_follow_up_customer.sql`
   - `docs/db/2026-09-08_02_eb_follow_up_owner_verification.sql`
   - `docs/db/2026-09-08_03_eb_follow_up_delivery_customer.sql`
   - `docs/db/2026-09-08_04_eb_follow_up_platform_seller.sql`
   - `docs/db/2026-09-08_05_eb_follow_up_customer_links.sql`
   - `docs/db/2026-09-08_06_eb_follow_up_acceptance.sql`
   SQL06 krävs tillsammans med kassan `2026-09-08.2`. Den stoppar nya köp utan fullständigt samtycke och ångerinformation, men ändrar inte tidigare beställningar. Äldre öppna kassor måste laddas om. Kör inte om SQL04 efter SQL06 eftersom den återställer äldre versionskrav i orderfunktionen.
   SQL01/02 krävs för kundverifieringen. SQL03/04 krävs före publicering av leveransbaserad beställarregistrering och central säljare. SQL03 registrerar första leveransens kund atomiskt under samma lås som köp och adressrättningar; ingen befintlig kontakt eller order skrivs över. SQL04 kräver förnyat samtycke till version `2026-09-08` för nya köp så att en tidigare öppen kassa med ett annat besiktningsföretag som säljare inte kan slutföras med gamla villkor. Befintliga orders säljare och villkorsversion ändras inte. Saknad konfiguration ger inte en reservväg för köp eller kundåtkomst. Samordna migrering och kodpublicering; äldre kod kan inte göra nya köp efter SQL04.
2. Publicera applikationskoden. Låt `EB_FOLLOW_UP_ENABLED` vara avstängd tills checklistan är klar. Befintliga köp kan fortfarande öppnas om nyförsäljningen stängs av.
3. Säljaren är centralt **JNH Consulting AB**, bolaget bakom HusHub. Namn, organisationsnummer och adress återanvänds från `PUBLIC_COMPANY_INFO`; kontaktadressen återanvänds från den uttryckligen godkända `PUBLIC_BESIKTAPP_CONTACT_EMAIL` (`jn@hedbjorn.se`). `followUpSeller.ts` lämnar aldrig ut det externa besiktningsföretagets identitet som säljare. `organizations.eb_follow_up_seller` och organisationsskaparens profil används inte längre för nya köp; den äldre kolumnen lämnas kvar. Pris 599 kr inklusive moms och fakturaunderlag till Admin styrs också centralt. Ingen säljarinställning behövs per besiktningsföretag. Säljaruppgifterna visas vid köp och fryses med ordern; befintliga beställningar behåller sin historiska säljare. Vid framtida byte av säljare behöver även nya köps samtyckesversion samordnas i klient, server och databas.
4. Kontrollera befintliga `APP_BASE_URL`, `RESEND_API_KEY`, `ASSIGNMENTS_MAIL_FROM`, `SUPABASE_SERVICE_ROLE_KEY` och `CRON_SECRET`. Produktionsbasadressen ska vara den rätta HTTPS-adressen. Lägg helst till en separat stark `EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY`; annars härleds krypteringen från service role-nyckeln. Beställar- och ägarlänkar lagras krypterat i mejlkön. **Rotera inte krypteringsnyckeln med väntande mejl eller aktiva personliga länkar utan en migreringsplan.** SQL05 krävs före publicering av den kodfria beställaråtkomsten; den skapar en separat tabell för hashade personliga länkar och återanvänder ordertransaktionen utan nya kodutskick.
5. Kontrollera Supabase `pg_cron`, `pg_net` och Vault. SQL09 återanvänder befintlig PDF-/uppföljningscron om den är konfigurerad. Alternativt används Vault-namnen `hushub_eb_follow_up_endpoint_url` (HTTPS-adress som slutar med `/api/cron/eb/follow-up`) och `hushub_eb_follow_up_cron_secret` (samma värde som serverns `CRON_SECRET`). Inga hemligheter ska läggas i Git eller SQL-filen.
6. Om SQL09 varnade om saknad konfiguration: konfigurera Vault och kör `select public.configure_eb_follow_up_mail_cron();`. Jobbet heter `hushub-eb-follow-up-mail-v1` och kör varje minut. Använd `select public.eb_follow_up_mail_cron_status();` för att kontrollera aktivt jobb och aktuell slutförd HTTP 200. Funktionen lämnar inte ut hemligheter. Enbart ett aktivt jobb bevisar inte fungerande mejlleverans.
7. Kontrollera slutliga köpvillkor, ångerhantering och manuella faktureringsrutiner med ansvarig säljare. Villkorsversion, pris, moms, samtycken, köpare och säljare sparas med beställningen. Informationen om digitala köp/ångerfunktion utgår från [Konsumentverkets informationskrav vid distansavtal](https://www.konsumentverket.se/marknadsratt-foretag/informationskrav-vid-distansavtal-regler-for-foretag/); implementationen är inte ett löfte om juridisk fullständighet.
8. Prova med särskild testbesiktning och kontrollerade testmottagare: personlig beställarlänk, köp, kvittens, fakturaunderlag, entreprenörsinbjudan, bild, svar, återöppning och ångerbegäran. Aktivera sedan `EB_FOLLOW_UP_ENABLED=true`.

## Automatisk mejlleverans

Order, inbjudningar och åtgärdshändelser läggs i en varaktig kö. Databaslås/lease hindrar parallella utskick av samma köpost. Avbrutna körningar kan återtas; misslyckanden försöks igen med ökande väntetid. Leverantörens idempotensnyckel skyddar mot dubletter. Koder som gått ut skickas inte. Efter uttömda försök blir posten `failed` och kräver operativ hantering — användaren ska inte behöva hålla rapporten öppen.

Övervaka `eb_follow_up_email_outbox` (behörig server/admin) för gamla väntande och misslyckade poster. Vanliga konfigurationsfel är avsändardomän, fel cronhemlighet eller ändrad krypteringsnyckel. Skriv aldrig ut krypterat innehåll, personliga länkar eller kunduppgifter i felsökningsloggar. Nycklar och verkliga utskick ingår inte i de lokala testerna.

Om en beställning avbryts efter bildkopiering men före aktivering kan privata, ännu oanvända kopior ligga kvar i `eb-follow-up-originals`. Automatisk rensning ingår inte; en eventuell senare rensningsrutin måste kontrollera orderreferenser och pågående beställningsförsök innan något tas bort. Befintliga originalbilder raderas eller skrivs aldrig över av kopieringen.

När en entreprenörslänk utfärdas på nytt återkallas föregående länk efter att det nya utskicket har köats. Det skyddar vid byte av kontakt, men mottagaren kan behöva invänta det nya mejlet. Köad leverans är inte samma sak som bekräftad leverans.

Känd kvarvarande begränsning i den äldre inbjudningsfunktionen: dubbelklick spärras i samma vy, men samtidiga utskick från olika flikar är inte atomiskt deduplicerade. De kan skapa två aktiva entreprenörslänkar och två mejl. Det påverkar inte antalet köp eller fakturaunderlag. Behörighetskontroll och avgränsning till tilldelade uppgifter gäller fortfarande båda länkarna.

## Lokal verifiering

- `node --experimental-strip-types --test test/eb-follow-up-*.test.ts` — köp/behörighet, atomiska databasåtgärder, ursprungsrapportens integritet och cron.
- `node --experimental-strip-types --test test/eb-customer-*.test.ts` — krypterade kundsessioner, personliga länkar, återkallelse/utgång, scope/CSRF, dolt publikt erbjudande och fakturaunderlag till Admin.
- `node scripts/test-eb-follow-up-ui.mjs` — verklig köpdelskomponent med lokal simulerad API, 390/1440 px, tangentbord, dubbelklick, samtycken, felbevarande och återöppning utan nytt köp. Inga verkliga mejl, beställningar eller databasanrop.
- `node scripts/test-eb-follow-up-portal-ui.mjs` — rollspecifik portal med simulerade svar: tilldelning/inbjudan, ångerbegäran, åtgärdsrapportering, bilder och mobil layout.
- `node scripts/test-eb-report-delivery-ui.mjs` — leveransdialog på mobil/dator: direkt angiven beställare utan uppdragsbekräftelse, övriga mottagare, skyddad omsändning och återförsök. Endast simulerade leveranser.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`
- `npm run build`

Databastesterna använder isolerad PGlite, inte produktionsdatabasen. Schemaläggartestet ersätter nätanrop med en lokal tabell. Kompilerade UI-testfiler och skärmbilder ligger i ignorerade `tmp/eb-follow-up-ui/`, `tmp/eb-follow-up-portal-ui/` och `tmp/eb-report-delivery-ui/`.
