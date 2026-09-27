# ÖB - varumärkesprofil 1.2

Beslutad designriktning: 2026-09-23.
Listdensitet justerad efter användarens återkoppling: 2026-09-24.
Omfattning: ÖB i BesiktApp. Ingen ändring av RenoApp, TU, EB eller Uppdrag.

## Status och källor

Användaren har godkänt riktningen med RenoApps listformspråk, ÖB:s blå färger
och det tillhörande mobilexemplet. Detta dokument är den textbaserade
specifikationen. PDF:en och bilderna illustrerar den; genererad bildtext eller
en enskild pixel i en mockup är inte en ny funktionsregel.

- **Beslutad design:** reglerna för hierarki, typografi, listor och mobil nedan.
- **Dokumenterad implementation:** se [införandet av 1.1](OB_BRAND_IMPLEMENTATION.md)
  och [utgivningshistoriken](OB_BRAND_RELEASE.md). Version 1.2 är inte införd genom
  denna dokumentuppdatering.
- **Efterföljande implementation:** den gemensamma ÖB-listan publicerades
  2026-09-23, se [publiceringskvittot](OB_OVERVIEW_RELEASE.md). Den tätare
  datorlayouten från 2026-09-24 är godkänd för publicering av användaren.

Formspråket utgår från `src/components/renoapp/renoapp-theme.css` och
`src/app/renoapp/app/cases/page.tsx`: neutrala statustexter, smal markering vid
radens vänsterkant, tunna linjer och lugna kontroller. RenoApps produktregler
eller globala CSS ska inte följa med automatiskt.

## Identitet som behålls

- BesiktApp är produkten, Överlåtelsebesiktning/ÖB är modulen och ÖB-runda är
  arbetsvyn. Ingen ny logotyp eller omdöpning av produkten.
- Originalet `public/report-assets/BesiktApp.png` används utan omritning eller
  omfärgning. Modulnamnet är en separat textetikett.
- ÖB-blått `#245EB5`, aktivt blått `#1D4890` och vald yta `#EDF3FC` behålls.
  Övriga ÖB-färger finns i profilpaketets `assets/colors.json` och `tokens.css`.
- Manrope används lokalt. Teckenavstånd är 0. Färg får aldrig ensam förmedla
  status, fel eller bedömning.
- Risk, fortsatt teknisk utredning, sparstatus och uppdragsstatus är olika
  begrepp. Listans avskalade statustext ersätter inte märkningarna i ÖB-rundan.

## Gemensamt formspråk

1. Låt innehållet styra hierarkin. Sidrubriker och sektioner ligger utan
   dekorativa kort. Använd kort för avgränsade verktyg, inte runt varje textbit.
2. Vita innehållsytor på ljus neutral bakgrund. Tunna avdelare, inga gradienter,
   kraftiga skuggor eller kort inuti kort. En samlad listyta får ha en tunn ram,
   men inte en extra inramning för varje rad.
3. Blått markerar handlingar, länkar, fokus och val. Det ska inte dominera all
   text. Undvik upprepade stora primärknappar i varje listrad.
4. Normal text har vikt 400, rubriker och viktig radinformation normalt 600.
   Vikt 700 används sparsamt, inte som standard för hela listor.
5. Använd etablerade Lucide-ikoner. Verktygsikoner får tillgängligt namn och
   tooltip; viktiga kommandon kan ha ikon och tydlig text.

| Yta | Dator | Mobil |
| --- | --- | --- |
| Sidrubrik i översikt | 26/34 px, vikt 600 | 22/30 px, vikt 600 |
| Sektionsrubrik | 20/28 px, vikt 600 | 20/28 px, vikt 600 |
| Huvudinnehåll i listan | 14/20 px, vikt 400/600 | 16/24 px, vikt 400/600 |
| Sekundär radinformation | 14/20 px, vikt 400 | 14/20 px, vikt 400 |
| Inmatning i listans verktygsrad | 14 px | minst 16 px |
| Pekmål | minst 44 px | minst 44 px, mål 48 px |

Storlekarna gäller översikter och listor. Rum och noteringsdialoger behåller
sina dokumenterade mönster tills de uttryckligen ändras. Datortabellens 14 px
är en fast, gemensam textstorlek, inte en storlek som krymper med fönstret.
Vid smalare tillgänglig yta eller större text byter listan till staplad layout.

## ÖB-listan på dator

- Den gemensamma listan placeras under de fyra befintliga verktygen på ÖB:s
  startsida. Uppdragsbekräftelser, Starta besiktning, Mina besiktningar och
  Visitkort finns kvar under övergången.
- En rad representerar ett uppdrag, inte en fastighet. Flera besiktningar på
  samma fastighet ska inte slås ihop. Ersatta bekräftelser hör till historiken
  för samma uppdrag, inte till dubbla aktiva rader.
- Datum, adress, ort, kund, uppdragsbekräftelse och besiktning har
  egna kolumner. Ort ligger direkt efter adress. Adressen får vikt 600;
  övriga cellvärden har samma textstorlek och normalt vikt 400.
- Uppdragsnummer visas inte i listan eller dess detaljrad, inte heller på
  mobil. Numret behålls i data och kan fortfarande användas för sökning.
- Utnyttja sidans bredd, upp till 1856 px inklusive sidmarginaler. Behåll de
  fyra befintliga verktygens avgränsade bredd; listan får breda ut sig under dem.
- Standardrader är 56 px vid normal textstorlek, oavsett antal länkar eller
  åtgärdsorsaker. Utfällda detaljer är ett avsiktligt undantag, inte ett sätt
  att tvinga in fullständiga långa texter i en fast höjd.
- Behåll tabellayouten även i mindre datorfönster och sidopaneler. Från
  56 rem innehållsbredd används tabell med kompaktare kolumner; under den
  bredden används mobilens staplade rader. Brytpunkten följer textstorleken.
- Långa cellvärden får ellips på datorn. Fullständig text finns både som
  tooltip och i en tangentbordstillgänglig detaljrad. Åtgärdsbehov markeras
  med en namngiven varningsikon som öppnar orsakerna; inte bara med färg.
- Sökning och filter samlas i en verktygsrad. Filter använder text och tunn
  blå understrykning, inte en rad färgade statusknappar. Sidstorlek och
  sidbläddring är nedtonade stödverktyg.
- Listan använder vita rader, tunna horisontella linjer och neutral
  statustext. Undvik vertikala rutnät, färgade helrader och statuspiller.
- En smal markering vid vänsterkanten kan ge extra vägledning. Betydelsen
  ska alltid finnas i text; markeringen ersätter inte någon av statuskolumnerna.
- Datorns två öppna-handlingar använder Lucide-ikoner med tooltip och
  tillgängliga namn som **Öppna besiktning** och **Acceptera uppdrag**.
  Mobilen behåller synlig text. Ikoner får inte ersätta statuskolumnerna.

## Mobil

- Samla de fyra verktygen under en utfällbar **Genvägar**-rad. Funktionerna
  finns kvar men deras formulär ska inte skjuta uppdragslistan långt ned.
  Visa öppet/stängt läge och stöd för tangentbord och skärmläsare.
- Byt tabellen mot en sammanhängande vertikal lista, inte en sidscrollande
  miniatyrtabell. Tunna avdelare skiljer raderna; undvik flytande kort per uppdrag.
- Varje rad visar adress, kund och datum, följt av två etiketter med värden:
  **Bekräftelse** och **Besiktning**. Hela statusen får radbrytas vid behov.
- Ge direkt åtkomst till bekräftelsen och besiktningen med separata,
  tydliga handlingar. Begränsa inte åtkomsten till svep eller en okänd ikon.
- Sökning ligger nära listan. Filter som inte ryms blir en vanlig väljare;
  sortering och **Kräver åtgärd** förblir åtkomliga. Minska inte textstorleken
  för att trycka in datorns filterrad.
- Inget innehåll döljs permanent bakom meny, tangentbord eller en fast kontroll.
  Den vanliga vertikala sidrullningen räcker.

## Gemensam besiktningslayout

Beslutad uppföljning 2026-09-27, första etappen implementerad och godkänd
av användaren för publicering efter verifiering:

- Alla moment använder samma kompakta besiktningshuvud med adress, moment,
  stegnummer och byggnadsnamn där momentet hör till en byggnad. Menyn ligger
  till höger och den fasta utkastikonen bredvid. På dator finns även tillbaka
  till besiktningslistan; på mobil finns samma utgång i stegmenyn.
- BesiktApps globala toppfält ersätts av besiktningshuvudet genom hela denna
  arbetsvy, inte bara i ÖB-rundan. Övriga sidor i produkten påverkas inte.
- Samma vita, oframade sidyta och sidmarginaler, med högst 1280 px arbetsbredd.
  ÖB-rundans innehåll behåller tills vidare sin läsbara bredd på 800 px inom
  denna yta. En separat datoranpassning av själva rundan återstår.
- Handlingar och Skicka utlåtande använder Manrope, ÖB-blå handlingar,
  gemensamma formulärkontroller och tunna avdelare i stället för dekorativa
  paneler. Mobilens inmatning är minst 16 px och pekmål minst 48 px.
- Utkastdialogen behåller telefonens tillbakafunktion även från ett rum.
  Autosparande, låsning, behörigheter och utskick ändras inte. Rapportens
  förhandsgranskning och frysta kunddokument har oförändrad rendering.

## Fastighet & uppdrag

Beslutad uppföljning 2026-09-25. Detta är en sidlokal formulärlayout, inte en
ändring av övriga ÖB-formulär eller rapportmallar.

- På bred datorvy: tre sektioner för **Objekt**, **Uppdragsgivare** och
  **Besiktningsuppdrag**. Omfattning och Närvarande ligger under dessa,
  bredvid varandra när utrymmet räcker. Smalare vyer staplar innehållet utan
  dubbla uppsättningar inmatningsfält.
- Byggnader ligger under objektuppgifterna som en kompakt lista med antal,
  byggnadsnamn och namngivna ikonverktyg för tillägg, redigering och borttagning.
  Ingen stor byggnadssektion ovanför formuläret och inga kort runt byggnaderna.
- Formulärstorlekar följer den gemensamma regeln för UB och Fastighet & uppdrag
  nedan. Den ersätter sidans tidigare sektionsrubriker på 20 px.
- Vita ytor, tunna avdelare, neutrala texter och ÖB-blå handlingar enligt
  profilens befintliga färger. Ingen ny generell krympning av sidans innehåll.
- Besiktningsmannens informationssektion visas inte på Fastighet & uppdrag.
  Profil, certifieringar, rapportdata, PDF:er och historiska snapshots är
  oförändrade. Det separata steget Granska har avvecklats enligt beslutet nedan.
- Autosparande, lokala utkast, låsning, tillägg och byggnadskommandon behåller
  befintlig funktion. Sparstatus har reserverat utrymme och får inte flytta
  formuläret under inmatning.

## UB och Fastighet & uppdrag

Beslutad uppföljning 2026-09-27 efter användarens jämförelse av sidorna.
Lokal implementation för granskning; ingen publicering ingår i detta beslut.

- Använd gemensamma fältetiketter, sektionskomponenter och kompakta stilar.
  Båda arbetsformulären använder Manrope och befintliga ÖB-färger.
- Dator med mus: 14 px inmatning, 13 px neutrala fältetiketter, 16 px
  sektionsrubriker med vikt 600, minst 44 px kontroller och 12 px fältavstånd.
  Kompaktheten hämtas från UB, inte dess äldre Arial-typografi eller kort.
- Mobil: 16 px inmatning, 14 px etiketter, 18 px sektionsrubriker, minst
  48 px pekmål och 16 px fältavstånd. Ingen förminskning för att få plats.
- Objekt, Uppdragsgivare och Besiktningsuppdrag ligger i tre kolumner när
  innehållsbredden är minst 64 rem, två från 42 rem, annars en. Postnummer
  och ort samt datum och tid kan delas i par när utrymmet räcker.
- UB:s dekorativa ytterkort, sektionskort, gradient och skuggor tas bort.
  Status och datum visas som etiketter med värden, inte små separata kort.
  Tunna avdelare används som på Fastighet & uppdrag; arbetsbredd högst 1280 px.
- UB:s uppdragstyp använder namngivna radioval i Besiktningsuppdrag, liksom
  Fastighet & uppdrag. Sparstatus behåller reserverat utrymme.
- Sidorna behåller sina olika arbetsflöden. Inga ändringar av autosparande,
  låsning, tidig start, acceptans, utskick, villkor, snapshots eller PDF:er.
  Bekräftelsens globala produktnavigation behålls; den är inte ett moment
  inne i besiktningen. Övriga ÖB-formulär och moduler påverkas inte.

Lokal verifiering 2026-09-27: 32 riktade tester och produktionsbygget är
godkända. Webbläsartester och granskade skärmbilder täcker dator, mobilbredder
från 320 px och 200 % text. Autosparande behåller fokus och rullningsläge;
låsning, godkända villkor och byte-identisk hämtning av arkiverad PDF har
kontrollerats med syntetiska testdata. Ingen publicering eller ändring av
kunddata har gjorts i denna etapp.

## Förutsättningar

- Byggnadsbild visas som en kompakt rad i samma lista som övriga sektioner,
  med statusen **Bild finns** eller **Ingen bild vald**. Panelen är stängd
  från början på både dator och mobil.
- Bilden och valen Ta bild, Välj bild och Bildbank visas först när raden öppnas.
  Använd samma panel och Föregående/Nästa-navigering som övriga förutsättningar.
  Låsta besiktningar tillåter visning men inte ändring av bilden.
- Placeringen gäller även besiktningar utan aktiverad byggnadsindelning.
  Fastighet & uppdrag visar inget separat bildval. Befintlig bildlagring behålls;
  detta kräver ingen migrering och ändrar inga publicerade rapporter.

## Granskning och leverans

Beslutad uppföljning 2026-09-27:

- Det separata menysteget Granska och dess egen komponent tas bort för alla
  besiktningar. Skicka utlåtande behåller sitt namn och sin förhandsgranskning.
- Sparad navigering till Granska öppnar Skicka utlåtande. Vald byggnad bevaras
  om den finns kvar; en uttrycklig länk till ÖB-rundan har fortsatt företräde.
- Gemensam rapportmotor, PDF-layout, kundens digitala utlåtande, leverans,
  godkännandekontroller och låsning ändras inte. Ingen datamigrering behövs.
- Publicerade snapshots och dokumenthistorik får inte skrivas om. Den lokala
  granskningen av textutkast är en annan funktion och finns kvar.

## Lokala textutkast

Beslutad uppföljning 2026-09-27:

- Visa lokala textutkast som en diskret ikon i sidhuvudet, inte som en egen rad
  ovanför innehållet. Samma funktion används i formulären och i ÖB-rundans
  plats-, rums-, noterings- och bildvyer för alla byggnader.
- Ikonen har en fast plats på 48 x 48 px även vid noll utkast. Antalet visas
  bara när utkast finns. Läsfel får en varningssymbol och förklarande text.
  Statusändringar får inte flytta innehållet eller störa fokus vid inmatning.
- Tooltip och tillgängligt namn beskriver lokala utkast. Noll utkast får inte
  benämnas "Allt sparat": kontrollen omfattar inte alla besiktningsdata.
- Klick öppnar den befintliga granskningen och jämförelsen med sparad text.
  Avvikande texter behålls; bara verifierat identiska lokala kopior rensas.

## Status är information, inte en ny arbetsprocess

**Uppdragsbekräftelse** beskriver kundens och uppdragets bekräftelseflöde.
**Besiktning** beskriver det faktiska besiktningsläget. Exempelvis ska
**Inväntar kund** kunna visas samtidigt som **Pågår**.

Visa inte **Klar** eller **Avslutad** bara för att en bekräftelse har omvandlats
till en besiktning. Kundens godkännande, besiktningsmannens acceptans och en
avslutad besiktning är skilda händelser. Sparad, skickad och levererad rapport
är också skilda saker.

Bildernas etiketter och filter illustrerar riktningen; de fastställer inte
en databasstatus eller nya regler för när något är avslutat. Före implementation
ska följande kontrolleras mot verkliga data och befintliga behörigheter:

- Hur bekräftelse- och besiktningsstatus räknas fram, inklusive tidig start,
  utkast, saknad bekräftelse, utgången länk och avbokning.
- Hur **Aktuella**, **Avslutade** och **Kräver åtgärd** väljer rader och hur
  vänstermarkeringen prioriteras när flera tillstånd gäller samtidigt.
- Vilken bekräftelse som är aktuell efter omskick/ersättning och hur historik
  bevaras utan dubbletter. Koppla inte ihop poster enbart genom samma adress.
- Vilken åtgärd användaren får utföra. Designen ändrar inte godkännandekrav,
  acceptans, avstämning, behörighet, låsning eller utskick.

## Referensbilder och leverans

Profilpaketet i `output/pdf/ob-brand/` innehåller en versionsmärkt PDF, regler,
färgdata, typsnitt/licens, originalets logotyp, Lucide-ikoner och två bilder:

- `assets/examples/desktop-v1.2.png`
- `assets/examples/mobile-v1.2.png`

Bilderna är AI-genererade koncept med fiktiva uppgifter, inte skärmbilder från
driftsatt ÖB. De visar godkänd visuell riktning, inte verifierad funktion eller
exakta pixelmått. Textreglerna ovan gäller vid avvikelser, exempelvis korta
åtgärdsnamn i datorbilden. Referensernas ursprung står i
`assets/examples/README.md` och kontrollsummor i `provenance.json`.

Referensbilderna/PDF:en är fortfarande version 1.2 och visar inte det tätare
listtillägget från 2026-09-24. Textreglerna ovan anger denna uppföljning.

Version 1.1 behålls som historik. Version 1.2 ersätter dess generella riktning
för översikter/listor och kompletterar, inte ersätter, ÖB-rundans arbetsvyer.

## Kontroll före införande

- Dator: 1024, 1280, 1440 och 1920 px. Mobil: 320, 360, 390 och 430 px.
- 200 % textförstoring, långa adresser/kundnamn och svenska tecken utan
  överlapp, dold statustext eller horisontell sidrullning.
- Tangentbord, synligt fokus, namngivna ikonverktyg, etiketter och pekmål.
- Båda statusarna begripliga utan färg; textkontrast minst 4,5:1.
- Tom lista, laddning, fel, utebliven åtkomst och filter utan träffar.
- Befintliga listor och skapandeflöden tillgängliga under övergången.
- Ingen förlust av uppdrag, historik, rapporter eller lokala utkast.

Denna leverans granskar profildokument och bilder. Den utgör inte ett utfört
mobiltest, ett funktionstest eller en publicering av listan.

## Beslutslogg

| Datum | Beslut | Avgränsning |
| --- | --- | --- |
| 2026-09-27 | Gemensam kompakt, ramfri formulärstil för UB och Fastighet & uppdrag. | Endast arbetsvyerna. 16 px sektionsrubriker på dator, 14 px fälttext, 44 px kontroller; mobilen behåller 48 px pekmål. Inga ändringar av historiska dokument eller spar- och godkännandeflöden. Lokal implementation, inte publicering. |
| 2026-09-27 | Samordna besiktningens sidhuvud, meny och grundstilar. | Första etappen omfattar arbetsvyn, inte rapporter eller datalagring. ÖB-rundans större datorlayout följer separat. Användaren godkände publicering efter den lokala förhandsvisningen och godkända tester. |
| 2026-09-23 | Använd RenoApps lugna listformspråk med ÖB:s blå profil. Den senaste datorriktningen och mobilexemplet blir referens för 1.2. | Användaren bad att uppdatera profilen efter godkännande av mobilexemplet. Äldre ingångar behålls under övergången. Ingen appimplementation eller publicering i denna leverans. |
| 2026-09-23 | Bygg den nya gemensamma listan under de fyra korten på ÖB:s startsida. | Separat lokal implementation för utvärdering. Båda gamla listorna och deras arbetsflöden behålls. Ingen publicering eller pensionering av gamla listor. |
| 2026-09-24 | Tätare datorlista efter jämförelsen med Fortnox: bredare yta, jämn typografi och stabila standardrader. | Visuell uppföljning. Detaljer är åtkomliga utan hover, mobilen behåller textlänkar och goda pekmål. Ingen ändring av statusregler eller arbetsflöden. |
| 2026-09-24 | Ta bort uppdragsnummer från översiktens visning. | Gäller dator, mobil och detaljrad. Nummer, sökning och ID-kopplingar behålls; ingen datamigrering. |
| 2026-09-24 | Visa ort i en egen kolumn efter adressen. | Dator och mellanbredder använder separata kolumner. Mobilen behåller orten i den staplade raden. Ingen ändring av sparade uppgifter. |
| 2026-09-25 | Kompakt datorlayout på Fastighet & uppdrag, med byggnader under Objekt och utan besiktningsmannens informationssektion. | Endast denna arbetsvy. Mobilens pekytor, Granska, sparfunktioner och all besiktningsmannadata och dokumenthistorik bevaras. |
