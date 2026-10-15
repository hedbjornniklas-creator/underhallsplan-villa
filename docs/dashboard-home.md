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
  stoppens ordning. ”Öppna resväg” öppnar Google Maps med köranvisningar från
  användarens position via bekräftade uppdrag. Preliminära uppdrag ingår inte
  i linjen eller köranvisningen. Dagar med fler än fyra stopp delas i flera länkar för
  att även mobila webbläsares gräns för mellanstopp ska fungera.
- Manuellt uppdateringsval och återgång till fliken läser om data. Fel i en
  enskild modul visas tydligt; övriga moduler fortsätter fungera. Vid förlorad
  åtkomst tas tidigare kunduppgifter bort från översikten.

Startsidan använder standardorganisationen, i enlighet med befintliga ÖB-, EB-
och Uppdrag-flöden. Ett explicit `orgId` måste vara samma organisation. TU och
Fuktsäkerhet behåller organisationsvalet i sina länkar. Gemensamt organisations-
byte ska inte aktiveras förrän alla underliggande flöden stöder det.

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

## Kontroll och förhandsvisning

```powershell
node --experimental-strip-types --test test/dashboard-model.test.ts test/dashboard-action-cases.test.ts test/dashboard-server.test.ts test/dashboard-calendar.test.ts test/dashboard-geocoding.test.ts test/dashboard-map-api.test.ts
node scripts/preview-dashboard.mjs --test
```

Förhandsvisningen använder riktiga UI-komponenter med syntetiska uppdrag.
Browserkontrollerna använder syntetiska kartplattor och blockerar externa anrop;
de kan aldrig skicka meddelanden eller skriva till produktionen. Starta separat
med `node scripts/preview-dashboard.mjs --port 5363` för att visa sidan lokalt.

API:erna är autentiserade, läser genom befintliga behörighetskontroller och
cachelagras inte i webbläsare/delade HTTP-cachar. Inga nya databasscheman behövs.
