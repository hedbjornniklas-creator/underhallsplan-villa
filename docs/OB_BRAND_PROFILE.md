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
  datorlayouten från 2026-09-24 är en lokal uppföljning för utvärdering.

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
- Datum, uppdragsnummer, adress, kund, uppdragsbekräftelse och besiktning har
  egna kolumner. Ort ligger på adressens andra rad. Adressen får vikt 600;
  övriga cellvärden har samma textstorlek och normalt vikt 400.
- Utnyttja sidans bredd, upp till 1856 px inklusive sidmarginaler. Behåll de
  fyra befintliga verktygens avgränsade bredd; listan får breda ut sig under dem.
- Standardrader är 56 px vid normal textstorlek, oavsett antal länkar eller
  åtgärdsorsaker. Utfällda detaljer är ett avsiktligt undantag, inte ett sätt
  att tvinga in fullständiga långa texter i en fast höjd.
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
| 2026-09-23 | Använd RenoApps lugna listformspråk med ÖB:s blå profil. Den senaste datorriktningen och mobilexemplet blir referens för 1.2. | Användaren bad att uppdatera profilen efter godkännande av mobilexemplet. Äldre ingångar behålls under övergången. Ingen appimplementation eller publicering i denna leverans. |
| 2026-09-23 | Bygg den nya gemensamma listan under de fyra korten på ÖB:s startsida. | Separat lokal implementation för utvärdering. Båda gamla listorna och deras arbetsflöden behålls. Ingen publicering eller pensionering av gamla listor. |
| 2026-09-24 | Tätare datorlista efter jämförelsen med Fortnox: bredare yta, jämn typografi och stabila standardrader. | Visuell uppföljning. Detaljer är åtkomliga utan hover, mobilen behåller textlänkar och goda pekmål. Ingen ändring av statusregler eller arbetsflöden. |
