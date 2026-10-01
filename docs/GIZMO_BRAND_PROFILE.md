# Gizmo / Uppdrag - varumärkesprofil 2.0

Beslutad riktning: 2026-10-01. Implementation och verifiering dokumenteras nedan.
Gäller Uppdrags interna projektlista, projektytor och tillhörande arbetsdialoger.
ÖB, EB, TU och RenoApp ändras inte. Offertdokument, avtalsversioner och kundens
godkännandeflöde får inte ändras som en följd av en visuell uppdatering.

## Grund

Utgår från [ÖB:s varumärkesprofil 1.2](OB_BRAND_PROFILE.md): kompakt hierarki,
sammanhängande listor, vita arbetsytor, tunna avdelare, lokalt Manrope och noll
teckenavstånd. ÖB:s blå modulidentitet eller produktregler kopieras inte.
Gizmos befintliga tokens i `src/components/tasks/uppdrag-theme.css` behålls.

- Gizmo är modulens namn. Projekt, projektarbete och uppgift beskriver olika nivåer.
- BesiktApps befintliga globala produktnavigation och logotyp behålls.
- Ingen ny maskot eller omritad logotyp ingår.
- Grafit #252A2D för primärhandlingar och viktig text, #101518 vid hover.
- Dämpad gul #F2D76A används sparsamt i vald navigering och förhandsgranskning.
- Grönblå #206961 används för länkar och tangentbordsfokus.
- Vita arbetsytor, neutral stödtext #596368 och avdelare #D5DCDD.
- Ingen gul/beige bakgrund över hela sidan, gradient eller dekorativ hero.
- Status uttrycks i ord; färg eller en stapel får aldrig ensam förmedla betydelsen.

## Struktur

1. **Projektlista:** välj projekt. Ingen redigerare eller förvalt projekt bredvid listan.
2. **Projektarbetsyta:** ett projekt, ett huvud och en gemensam navigering.
3. **Åtgärd:** sidopanel för omfattning, underlag och intern kalkyl.

Projekt är standardvyn på /uppdrag. Aktuellt och Statistik behålls som
separata tvärgående vyer. Länkar till en specifik befintlig uppgift öppnar fortsatt
uppgiften i Aktuellt; uppgifter och projekt slås inte ihop i databasen.

Projektnavigering: Översikt, Projektarbete, Offert och avtal, Val och tillval,
Betalningsplan, Tidsplan, Bilder och filer. Visa som beställare är en avskild
förhandsgranskningshandling i projekthuvudet. Kundens sida har inte intern meny.
Granska grundavtal hör till Offert och avtal, inte till ytterligare en projektnivå.

## Listor och dator

- Högst 1856 px för listan och 1600 px för projektets meny plus arbetsyta.
- En rad per projekt, med namn/adress, beställare, status och konkret åtgärdsbehov.
- Vita rader, tunna horisontella avdelare, inga kort eller statuspiller per projekt.
- Sökning, aktivt/avslutat/alla-filter och Nytt projekt i samma verktygsrad.
- Sortering och sidbläddring är sekundära; högst 25 projekt per sida.
- Projektrader är normalt 72 px inklusive två rader för projekt/objekt.
  Detta är en minhöjd: text får radbrytas utan att klippas.
- Sidrubrik 26/34 px vikt 600; sektionsrubrik 20/28; underrubrik 16/24.
  Listtext 14/21 px, vikt 400, projektnamn vikt 600. Ingen viewportskalad text.
- Kontroller minst 44 px. Lucide-ikoner med namn och tooltip för verktyg.
- Sidomenyn ligger kvar inom projektet. Åtgärdsdialoger behåller stängningsskydd,
  tangentbordsfokus och samma visuella identitet även när de renderas via portal.

## Mobil

- Sidrubrik 22/30 px, listtext och inmatning minst 16 px, kontroller minst 48 px.
- Projektlistan byter till staplade rader under 56 rem innehållsbredd.
- Projektnavigeringen blir en horisontellt rullningsbar navigeringsrad under
  768 px. Bara menyn får rulla i sidled, inte formulär eller hela sidan.
- Ingen fast nederkantsrad som täcker formulär eller tangentbord.
- Samma funktioner och uppgifter som på dator, inte en andra datamodell.

## Sanning och säkerhet i gränssnittet

- Visa sparat, osparat och pågående arbete utifrån verkligt tillstånd.
- Byte mellan projektdelar behåller formulärutkast och pågående uppladdning.
  Byte av projekt eller omladdning är inte samma sak som ett internt vybyte.
- Utkast, publicerad offert och godkänt grundavtal är olika tillstånd.
- Betalningsplanens belopp är inte fakturerat eller betalt. Ingen faktureringsgraf
  visas innan en verklig fakturakälla finns.
- Val/tillval ligger separat från grundavtalet. Planering är ingen beställning.
- Tidsplan visar befintliga avtalstider och planerade beslutsdatum. Full
  produktionsplanering med milstolpar och beroenden är fortfarande ett senare steg.
- Dokumentåtkomst och delning använder befintliga behörighetsregler.
- Äldre /kund-länkar leder till samma projekts Offert och avtal.
- Den interna projektmenyn och projekthuvudet ska inte följa med vid utskrift.

## Beslutslogg

- 2026-10-01: Användaren godkänner projektlista och gemensam projektnavigering nu,
  inte längre som enbart framtida riktning. ÖB:s formspråk är förebild, Gizmos
  färger och identitet behålls. Befintliga funktioner återanvänds.
- Tidigare namnändring till Projektarbete kvarstår inne i projektet.
  Listnivån heter Projekt för att skilja val av projekt från arbete i projektet.

## Verifiering före publicering

Kontrollera listval, sökning, filter, tomläge, direktlänk och webbläsarens tillbaka.
Prova osparat offertutkast och planering genom alla projektdelar, betalningsplan,
åtgärdspanel, filvisning och skrivskyddad beställarförhandsgranskning. Kontrollera
dator, mobil och tangentbord, samt att inga utskick sker enbart genom navigering.

### Lokal kontroll 2026-10-01

- 172 automatiserade tester för action-cases passerade, inklusive sju nya för
  projektrouter, organisationsavgränsning, åtkomst och äldre länkar.
- TypeScript och riktad ESLint passerade.
- Produktionsbygget (`next build --webpack`) passerade med projektets befintliga
  lokala miljöinställningar. Den isolerade arbetskopian har ingen egen miljöfil.
- Klicktest med fiktiva data: sökning, tomt sökresultat, avslutade projekt,
  nytt projekt till rätt arbetsyta, åtgärdspanel och sparning.
- Osparat offertutkast, planerade tillval och betalningsrader behölls vid vybyte.
  Simulerat sparfel behöll texten; nytt sparförsök lyckades.
- Beställarförhandsgranskningen visade publicerad avtalsversion, inte ett
  osparat internt utkast. Inget verkligt utskick eller kundgodkännande gjordes.
- Dator samt mobilbredder 390 och 344 px kontrollerade. Smal projektlista
  staplar rader och verktyg utan horisontellt sidöverflöde.
- Projektmenyn, webbläsarens tillbaka och fokus i projektdialogen provades.
  Tidsplan är fortsatt en vy över befintliga tider, inte en ny planeringsmotor.

Den lokala UI-fixturen återanvänder produktionskomponenterna med en isolerad
testserver. Den ersätter inte kontroll av riktiga databasbehörigheter och
utskick efter publicering. Driftsättning verifieras separat mot publicerad commit.
