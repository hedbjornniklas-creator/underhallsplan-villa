# Startsida: Min arbetsdag

`/dashboard-v1` samlar BesiktApps fem arbetsområden: överlåtelsebesiktning,
entreprenadbesiktning, tekniska utredningar, fuktsäkerhet och Uppdrag.

## Innehåll och flöden

- Kompakta modulkort visar aktiva uppdrag och antal nästa steg. Moduler utan
  behörighet visas inte och läses inte in. Tillgängliga moduler visas även
  när de saknar aktuella uppdrag.
- Åtgärdslistan skiljer besiktningar, uppdragsbekräftelser och övriga uppgifter.
  Befintliga statusar bestämmer nästa steg. Länkarna öppnar modulens vanliga
  arbetsflöde; startsidan skickar inte bekräftelser och godkänner inte uppgifter.
- Sökning och modulfilter gäller åtgärdslistan, kalendern, uppdragen och kartan.
  Kategorifiltret gäller enbart åtgärdslistan.
- Kalendern visar en hel vecka inklusive helger. Skickade uppdragsbekräftelser
  med ett föreslaget datum visas som gula, streckade preliminära uppdrag med
  aktuell bekräftelsestatus. Även daterade bokningsutkast i ÖB, EB och TU visas
  preliminärt med statusen ”Bekräftelse ej skickad”. En initial planerad
  EB-besiktning visas preliminärt även innan bekräftelsen har skapats.
  Utkast utan datum och avbrutna eller arkiverade bekräftelser skapar inga nya
  preliminära besök. En befintlig startad eller bekräftad besiktning behåller
  sin registrerade besökstid när ett nytt bekräftelseutkast tas fram. När
  uppdraget bokas visas samma uppdrag som bekräftat utan dubblett.
  Vald dag styr uppdragslista och karta. Tider och datum visas i Europe/Stockholm.
  Besök utan registrerad tid visas med ”Tid ej angiven”. Uppgiftsdeadlines
  skapar inte kalenderbesök.
- Uppdrag-modulens åtgärdsärenden med ”Datum för platsbesök” visas preliminärt
  som ”Planerat platsbesök”. Ärendets orderstatus bekräftar inte själva
  platsbesöket. Avslutade och avbrutna ärenden visas inte. Kalendern läser
  dessa besök med organisationsfilter och den inloggade användarens RLS-klient.
  Fuktsäkerhet har ännu inga besöksdatum och bidrar därför inte med kalenderbesök.
- Kartans blå, numrerade stopp följer uppdragslistans bekräftade besök.
  Preliminära uppdrag visas med gula klockmarkörer och tydlig status när de
  öppnas. Kartan anpassas för att visa båda typerna. Den streckade linjen visar
  de bekräftade stoppens ordning.
- ”Restid från företaget” visar beräknad körtid och sträcka från organisationens
  registrerade företagsadress till första uppdraget och sedan mellan uppdragen
  i kalenderns tidsordning. Även en dag med ett enda uppdrag får en restid.
  Preliminära uppdrag ingår som standard och kan väljas bort i beräkningen.
  Tiderna använder vägnätet, utan aktuell trafik eller återresa till företaget.
  Generella gatpositioner märks som ungefärliga. Saknad företagsadress eller
  olokaliserade stopp ger ett tydligt meddelande, ingen ofullständig totalsumma.
  ”Öppna resväg” använder samma företagsstart och uppdragsurval i Google Maps.
  Dagar med fler än fyra stopp delas i flera länkar för
  att även mobila webbläsares gräns för mellanstopp ska fungera.
- Manuellt uppdateringsval och återgång till fliken läser om data. Fel i en
  enskild modul visas tydligt; övriga moduler fortsätter fungera. Vid förlorad
  åtkomst tas tidigare kunduppgifter bort från översikten.

Startsidan använder standardorganisationen, i enlighet med befintliga ÖB-, EB-
och Uppdrag-flöden. Ett explicit `orgId` måste vara samma organisation. TU och
Fuktsäkerhet behåller organisationsvalet i sina länkar. Gemensamt organisations-
byte ska inte aktiveras förrän alla underliggande flöden stöder det.

## Inloggning efter inaktivitet

Startsidan och de övriga skyddade modulerna förnyar sessionen i en skrivbar
proxy. Förnyade cookies skickas både till den efterföljande
serverrenderingen och till webbläsaren. Sidans produkt-, organisations- och
modulbehörigheter kontrolleras fortfarande separat; sessionen ger ingen extra
behörighet. Saknad eller återkallad session skickas till inloggningen med
den öppnade sidan och säkra frågeparametrar som återgång.

Ett tillfälligt fel vid sessionsförnyelsen visar en återhämtningssida med status
503 och utan cachelagring, i stället för en omdirigeringsloop. Layouten skiljer
verklig `PRODUCT_ACCESS_REQUIRED` från andra tekniska fel. Bara det första
beskrivs som saknad behörighet. Om ett API-anrop efter återgång till fliken får
401 tas tidigare kunduppgifter bort och samma återhämtningsalternativ visas.

Sidan förklarar nästa steg och erbjuder ”Försök igen”, ”Logga in igen” och en
länk till HusHub. Ny inloggning avslutar först den lokala sessionen, endast efter
knapptryck, så att den befintliga inloggningen inte skickar användaren tillbaka
till felet. Vid verklig saknad behörighet hänvisas användaren till företagets
administratör. Tekniska felmeddelanden och kunduppgifter visas inte på felsidan.
Se [Gemensam återinloggning](session-recovery.md) för modultäckning och säkra
returadresser.

## Karttjänster

Leaflet visar OpenStreetMaps kartplattor med källangivelse. Registrerade
koordinater används direkt. Adresser som saknar koordinater slås upp på servern
i Photon när kartan blir synlig. Bara fastighetsadressen skickas till tjänsten,
utan kundnamn, uppdragsrubrik eller användar- och organisationsidentitet.
Uppslag cachelagras i processminnet och köas med minst 1,1 sekunder mellan anrop.

Standardleverantören är `https://photon.komoot.io/api/`. Det är en publik
demotjänst utan tillgänglighetsgaranti, avsedd för måttlig användning enligt
[Photon-projektets dokumentation](https://github.com/komoot/photon#demo-server).
För större användning eller flera serverinstanser används egen Photon-tjänst
och gemensam cache/anropsbegränsning. `DASHBOARD_GEOCODING_URL` ersätter
leverantören med en kompatibel Photon-API-adress; `DASHBOARD_GEOCODING_ENABLED=false`
stänger av adressuppslag. Publik Nominatim används inte.

Geokodning avvisar träffar på endast ort/land och främmande gatunamn. När
adressen anger ort måste även karttjänstens ortsuppgifter stämma.
Gatuträffar utan säker husposition märks som ungefärliga. Saknade adresser och
misslyckade uppslag förblir synliga i uppdragslistan. Köranvisningarna kan
öppnas även när den inbäddade kartan eller geokodningen är otillgänglig.
Google Maps-länkarna följer dess
[dokumenterade URL-format](https://developers.google.com/maps/documentation/urls/get-started).

Körtider hämtas på servern från OSRM, normalt
`https://routing.openstreetmap.de/routed-car/route/v1/driving/`, enligt dess
[API](https://project-osrm.org/docs/v5.24.0/api/) och
[användningsregler](https://routing.openstreetmap.de/about.html). Endast
koordinater skickas till routingtjänsten. Anrop identifierar HusHub och köas
med minst 1,1 sekunder mellan anrop; koordinatbaserade resultat cachelagras i
en timme utan användar-, kund- eller uppdragsidentiteter. Gränsen är 25 punkter
inklusive företaget: större resvägar får ingen uppskattning som tyst utelämnar
stopp. `DASHBOARD_ROUTING_URL` kan ange en egen kompatibel OSRM-tjänst och
`DASHBOARD_ROUTING_ENABLED=false` stänger av beräkningen. Den publika tjänsten
är avsedd för måttlig användning; större trafik kräver egen tjänst och gemensam
anropsbegränsning över serverinstanser. Kartans stopp och Google Maps-länkar
fungerar även när körtidstjänsten är otillgänglig.

## Kontroll och förhandsvisning

```powershell
node --experimental-strip-types --test test/dashboard-model.test.ts test/dashboard-action-cases.test.ts test/dashboard-server.test.ts test/dashboard-calendar.test.ts test/dashboard-geocoding.test.ts test/dashboard-map-api.test.ts
node --experimental-strip-types --test test/dashboard-routing.test.ts test/dashboard-travel-api.test.ts
node --experimental-strip-types --test test/organization-create-proxy.test.ts test/dashboard-access-recovery.test.ts
node scripts/preview-session-recovery.mjs --test
node scripts/preview-dashboard.mjs --test
```

Förhandsvisningen använder riktiga UI-komponenter med syntetiska uppdrag.
Browserkontrollerna använder syntetiska kartplattor och blockerar externa anrop;
de kan aldrig skicka meddelanden eller skriva till produktionen. Starta separat
med `node scripts/preview-dashboard.mjs --port 5363` för att visa sidan lokalt.

API:erna är autentiserade, läser genom befintliga behörighetskontroller och
cachelagras inte i webbläsare/delade HTTP-cachar. Inga nya databasscheman behövs.
