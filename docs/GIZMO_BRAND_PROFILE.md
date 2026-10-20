# Gizmo / Uppdrag - varumärkesprofil 2.3

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

Projektnavigering: Översikt, Projektarbete, Offert, Avtal, Val och tillval,
Betalning och fakturering, Tidsplan, Frågor och beslut, Bilder och filer, Delning. Registerflikarna ligger
över arbetsytan på både dator och mobil. Visa som beställare är en avskild
förhandsgranskningshandling i projekthuvudet. Kundens sida har inte intern meny.
Granska grundavtal hör till Avtal, inte till ytterligare en projektnivå.

Beslut 2026-10-19: Frågor och beslut använder en kompakt sammanhängande tabell
med frågenummer, rubrik, ansvarig, status i ord samt både skapad- och uppdateringstid. Frågan öppnas
i en högerpanel, med samma grafit, grönblå fokus, Manrope och raka avdelare som
övriga projektet. Mobilen staplar tabellens uppgifter och använder en panel i
full bredd. Inga nya färgteman, kortlistor eller ändringar av avtalsvyn ingår.
Förtydligande 2026-10-19: fliken ligger efter Tidsplan. Beställare återanvänds
direkt i ansvariglistan utan extra bock eller automatisk delning. Spara och skapa
nästa öppnar ett tomt formulär först efter bekräftad sparning. Se
[Frågor: beställare och snabbregistrering](gizmo-project-question-improvements.md).
Beslut 2026-10-19: Projektansvarig ligger under Översikt. Frågans deltagare och
delade dialog visas i samma högerpanel, med Intern anteckning och Intern
historik separerade från kunddialogen. Se [Frågedialog och deltagare](gizmo-question-dialogue.md).
Beslut 2026-10-20: Delning ligger sist och använder Tydlig tabell med fem
kompakta rader, synlighetsstatus i ord och ett reglage per kundflik. Bara
projektansvarig kan ändra; sparning sker automatiskt med fel och återförsök i
en fast statusyta. Visa som beställare visar faktiskt delat material för vald
beställare, inte avtalsutkast. Se [Delning](gizmo-customer-sharing.md).
Beslut 2026-10-20: Översikt använder den godkända varianten Nästa steg med
oinramade informationsytor, cirkeldiagram, rundade tidsstaplar och diskreta
datumstatusfärger. Registerflikarna och alla befintliga redigerare behålls.
Undantaget gäller endast den interna översikten, inte Projektarbetets tabeller,
avtalet eller kundens sida. Se [Projektöversikt](gizmo-project-overview.md).

## Listor och dator

- Beslut 2026-10-20: Kalkylens frågeteckenikon bredvid Lägg till rad öppnar en
  läsbar manual utan att stänga pågående redigering. Ofullständiga kalkyler visar
  en tydligt märkt Preliminär summa och varning. Prispåslag skiljs från moms och
  kostnadsfält och summor märks exklusive moms. Avtal och betalningsplan ändras
  inte. Se [Kalkylhjälp](gizmo-project-costing-help.md).
- Beslut 2026-10-19: Kalkyl i åtgärdens högerpanel använder en gemensam tabell
  med Klar, Kalkylrad, Kostnad, Påslag och Kundpris. Samtliga belopp är exklusive
  moms. En summarad ersätter de dubbla beloppen i sidfoten. Kalkylpanelen får
  vara högst 1120 px; Omfattning behåller sin tidigare bredd. Pennan öppnar
  radens detaljer. Massmarkering, arbetsdelar, kostnadsslag, prisunderlag och
  AI-verktyg ligger under Fler verktyg. Vanlig vy har bara Klar-bocken.
  Mobilen staplar radnamn och märkta belopp, med minst 48 px pekytor.
  Ofärdig kalkyl heter Kalkyl pågår, inte Pris behövs när belopp redan finns.
  En tom Klar-bock ändrar inte kostnad eller kundpris. Offertprissatta rader
  styrs fortfarande av sitt underlag och material som ingår dubbelräknas inte.
- Högst 1856 px för listan och 1600 px för projektets meny plus arbetsyta.
- Den interna avtalssidan har högst 1080 px arbetsbredd, centrerad inom
  projektet. Enkla inmatningsfält är högst 576 px, datum 220 px och längre
  textfält 832 px. Korta relaterade fält kan ligga bredvid varandra på dator.
  Projektets registerflikar och kundens dokumentvy ändras inte av detta.
- Avtalets sammanfattningsrader är normalt 52 px, utan tomma mellanrum mellan
  sektionerna. Prisrader är normalt 44 px och handlingar 48 px på dator;
  längre namn får fortfarande radbrytas. Rubrikband är 32 px. Formulärets
  lokala mellanrumsenhet är 3 px, utan att minska textstorleken.
  Datorns avtalsfält och kommandon har minst 36 px höjd, prisverktyg 32 px.
  Detta är ett avgränsat undantag från övriga projektytors 44 px kontroller.
  Mobilen behåller minst 48 px pekmål och 16 px inmatningstext.
- Öppen huvudsektion i avtalsformuläret har tonad rubrikrad #EDF1F1,
  en 3 px grönblå vänstermarkering #206961 genom rubrik och innehåll,
  20 px indrag för båda samt en rak 2 px nederkant #D5DCDD. Efter den
  öppna sektionen är avståndet till nästa rubrik 12 px. Innehållet är vitt,
  utan skugga eller kortform. Stängda sektioner behåller sina kompakta rader.
  Markeringen gäller endast huvudsektioner, inte arbetsdelar eller betalrader
  inne i dem. Kundens dokumentvy och övriga moduler ändras inte.
- En rad per projekt, med namn/adress, beställare, status och konkret åtgärdsbehov.
- Vita rader, tunna horisontella avdelare, inga kort eller statuspiller per projekt.
- Projektarbete använder varianten **Tydlig tabell**: tonad rubrikrad #EDF1F1,
  grafitfärgade kolumnnamn i 12 px/vikt 600 och vita åtgärdsrader med raka
  avdelare, utan rundade hörn. Åtgärdsnamn har vikt 600; stödtext är dämpad.
  Rader har minst 60 px höjd och får växa när text behöver radbrytas.
- Handlingsförteckningen i Avtal använder samma tabellvariant och tokens.
  Typ, namn och datum sammanfattas i en rad. En handling öppnas åt gången
  för redigering; nya handlingar öppnas direkt. Filöppning finns i raden med
  ikon, tooltip och separat flik. Långa typer har tooltip och visas i sin
  helhet vid redigering. På smal yta staplas typ och datum under namnet.
  Alla bilagor till avtalet väljs här, även bilder. Ingen separat sektion för
  Övriga bilagor används. Underlag som inte valts ligger kvar i projektbiblioteket.
- Arbetsdelar och avgränsningar i Avtal använder samma kompakta radprincip:
  tonad rubrikrad, normalt 52 px på dator, rubrik, kort sammanfattning och kundpris.
  En rad öppnas åt gången för alla textfält, pris, flytt och borttagning.
  Den öppna raden är dämpat gul; pekning/fokus är grönblå. Redigering ligger
  i arbetsytan, inte i en andra offertvy.
  Masshantering använder en egen krysskolumn och Välj alla med delmarkerat
  tillstånd. Markerade rader är grönblå, oberoende av vilken rad som är öppen.
  Verktygsraden har fast minhöjd även utan markering. Borttagning och byte
  mellan grundåtagande/avgränsning bekräftas med berörda rader och konsekvens.
- Val och tillval använder kategorirader med antal alternativ och kundens val,
  inte en summering av alternativens priser. En kategori öppnas åt gången;
  gemensam specifikation och beslutsdatum ligger över de kompakta alternativraderna.
  Alternativets egna texter, pris och PDF-bilagor öppnas i en sidopanel till höger,
  med kategorilistan kvar bakom. På mobil fyller panelen skärmen. Status och
  alternativdatum visas inte; beslutsdatum tillhör kategorin. På mobil får långa namn och
  prisunderlag egna rader. Kundens alternativ använder en radiogrupp per kategori
  och ett separat sparkommando. Öppen kategori markeras med neutral rubrik och
  grönblå vänsterkant, utan nästlade kort. Detta följer produktbeslutet 2026-10-18
  i gizmo-customer-overview.md; avtalets utseende, innehåll och belopp ändras inte.
- Beslut 2026-10-19: Alternativets pris använder Projektarbetets kompakta
  kalkyltabell med kostnad, påslag och kundpris per rad, pennöppnade detaljer
  och en intern Klar-bock. Panelen får vara 1120 px bred. Belopp i tabellen
  är exklusive moms; en separat slutsumma visar moms och kundpris inklusive.
  Samlat kundpris är ett aktivt alternativ till automatisk beräkning.
  Se [Egna kalkylrader i Val och tillval](gizmo-choice-costing.md).
- Beslut 2026-10-19: Den interna redigeringen av Val och tillval autosparas,
  inklusive bekräftade borttagningar och ångra. Manuella sparknappar tas bort.
  Sparar, Sparat och fel med Försök igen visas i en fast statusyta, även i
  alternativpanelen. Visa för beställaren förblir ett separat bekräftat kommando;
  kundens valknapp och avtalets sparning ändras inte.
  Se [Autosparning av Val och tillval](gizmo-choice-autosave.md).
- Avtalsstatus är en hopfällbar fullbreddsrad över formuläret. Grundstatus och
  belopp syns direkt; utskick, granskning och versionshistorik öppnas vid behov.
  Ingen fast högerspalt tränger ihop avtalsfälten.
- När ABS 18 väljs är dess standardvillkor en fast rad i samma handlingslista,
  med versionsbeteckning och filöppningsikon. Den kan inte misstas för ett
  redigerbart formulär eller tas bort medan den avtalsgrunden är vald.
- Arbetsmiljö har ett redigerbart grundvärde baserat på ABS 18-formulärets
  arbetsmiljöavsnitt. Befintliga egna texter behålls. Standardvärdet fylls in
  en gång i ett tomt avtalsutkast; raderad text får inte återskapas automatiskt.
  I Avtal finns Infoga standardtext när ABS 18 är valt. Befintlig text ersätts
  bara efter bekräftelse; ett tomt fält fylls direkt. Knappen använder samma
  autospar och avtalslåsning som fältet och infogar det redigerbara sammandraget.
- Uppdragets två standardtexter från ABS 18-formuläret visas separat från
  PDF-bilagan, efter projektspecifika undantag. De kan redigeras i avtalet och
  fryses med versionen. Övriga överenskommelser ligger under Övrigt, inte som
  en extra sektion för beställarens arbeten.
- Övrigt har Arbetsplatsens förutsättningar som en kompakt, öppningsbar lista:
  byggström, vatten, toalett/handtvätt, omklädning/dusch, matplats/paus,
  förråd/upplag, tillträde/parkering och städning/avfall. Varje punkt anger
  vem som ordnar, vem som bekostar samt plats och villkor. Inga skyldigheter
  eller kostnader väljs automatiskt. Tomma punkter utelämnas ur avtalet;
  påbörjade punkter måste kompletteras före utskick. Avtalsutkastets autospar
  och versionslåsning används. Praktiska överenskommelser ersätter inte
  arbetsmiljöansvaret och kopieras inte automatiskt till andra projekt.
- Avrådande består av två direkt redigerbara textfält enligt ABS 18:s
  formulär: arbetena som avrådandet gäller och På grund av. Ingen statusmeny
  eller separat avrådansdag. Tomma fält sammanfattas som Inte angivet;
  när ett av fälten fylls behöver även det andra fyllas före utskick.
  Tidigare beställarbesked visas under Övrigt, inte som ett tredje fält här.
- Priset i Avtal utgår från ABS 18: Fast pris, Löpande räkning eller Fast +
  löpande. Moment visas som kompakta prisrader med tonat rubrikband, eget
  redigeringsläge och borttagning. Kundpriser hämtas genom val av projektrader;
  ingen intern priskalkyl visas i Avtal. Prisredovisning väljs separat från
  beräkningen: delmoment med eller utan delpriser, eller endast totalsumma.
  Arbete/material kan redovisas tillsammans eller separat utan gissad fördelning.
  Löpande del visar timpris, arbetsledning och arvode på självkostnad, aldrig
  en påhittad kontraktssumma. Blandat pris skiljer tydligt ut den fasta delen.
  Prisform och redovisningsval ligger före prislistan. Avtalets priser är en
  enda redigerbar vy som följer vald redovisning, utan en andra prislista under
  I avtalet. Vid endast totalsumma öppnas dolda delmoment genom ett särskilt
  redigeringsval; detta ändrar inte hur priserna redovisas till beställaren.
  Separat arbete/material visas som egna kolumner när delpriser redovisas.
  Val av beräkningsgrund visas endast när redovisningen tillåter klumpsumma.
- ÄTA har egna prisgrunder i Avtal, oberoende av grundpriset: Fyll i här eller
  Enligt prisbilaga. Timpriser och påslag visas som två kompakta tabeller bredvid
  varandra på dator, staplade på smal yta. En timprisrad redigeras åt gången.
  Arbetsledning använder ordinarie timpris om ingen egen rad anges. Timpriser
  inkluderar arvode och moms; påslag anges per kostnadsslag på självkostnad
  exklusive moms. Prisbilagan väljs en gång, får namn/datum/version och ingår i
  samma handlingsförteckning. Bara valt prissättningssätt visas för beställaren.
  Befintlig ÄTA-text behålls som egna villkor. Standardvillkor är ett redigerbart
  projektspecifikt sammandrag, inte en ändring av den ursprungliga ABS 18-filen.
- Hela åtgärdsraden öppnar den befintliga sidopanelen. Pekning och
  tangentbordsfokus ger grönblå ton #F1F6F5 och en tunn vänstermarkering.
  Öppen åtgärd markeras med befintlig dämpad gul färg. Markeringar och
  fokusram får inte ändra radens storlek eller flytta andra rader.
- Sökning, aktivt/avslutat/alla-filter och Nytt projekt i samma verktygsrad.
- Sortering och sidbläddring är sekundära; högst 25 projekt per sida.
- Projektrader är normalt 72 px inklusive två rader för projekt/objekt.
  Detta är en minhöjd: text får radbrytas utan att klippas.
- Sidrubrik 26/34 px vikt 600; sektionsrubrik 20/28; underrubrik 16/24.
  Listtext 14/21 px, vikt 400, projektnamn vikt 600. Ingen viewportskalad text.
- Kontroller minst 44 px. Lucide-ikoner med namn och tooltip för verktyg.
- Registerflikarna ligger kvar inom projektet. Åtgärdsdialoger behåller stängningsskydd,
  tangentbordsfokus och samma visuella identitet även när de renderas via portal.

## Mobil

- Sidrubrik 22/30 px, listtext och inmatning minst 16 px, kontroller minst 48 px.
- Projektlistan byter till staplade rader under 56 rem innehållsbredd.
- Projektnavigeringen blir en horisontellt rullningsbar navigeringsrad under
  768 px. Menyn får rulla i sidled, inte formulär eller hela sidan.
- Dokumentets pristabell får rulla i en egen behållare vid separat redovisning
  av arbete/material. Belopp hålls på en rad; siffror får inte brytas mitt i talet.
- Ingen fast nederkantsrad som täcker formulär eller tangentbord.
- Samma funktioner och uppgifter som på dator, inte en andra datamodell.
- I smalt Projektarbete staplas radens uppgifter. Rubrikbandet behålls med
  "Åtgärd" medan övriga kolumnrubriker döljs. Långa namn bryts utan sidrullning.

## Sanning och säkerhet i gränssnittet

- Visa sparat, osparat och pågående arbete utifrån verkligt tillstånd.
- Autosparstatus har reserverad höjd i åtgärdspanelens sidfot. Ingen tillfällig
  sparrad ovanför projektlistan som flyttar innehållet vid varje ändring.
  Sparfel visas med befintlig toast och finns kvar i åtgärdsraden tills de är
  lösta. Sidopanelen behåller utkastet och erbjuder ett nytt sparförsök.
- Navigation följer `docs/UI_FEEDBACK_STANDARD.md`: projektlänkar använder
  gemensamma `PendingLink`, visar vänteläge direkt och spärrar upprepade klick.
  En långsam sidladdning visar "Öppnar projekt…" utan uppskattad procentsats.
  Läsfel visas på sidan med "Försök igen" som hämtar om serverunderlaget.
- Byte mellan projektdelar behåller formulärutkast och pågående uppladdning.
  Byte av projekt eller omladdning är inte samma sak som ett internt vybyte.
- Utkast, publicerad offert och godkänt grundavtal är olika tillstånd.
- Avtal har eget utkast och egen revision. Offert och Projektarbete är endast
  källor vid uttrycklig import. Hämta från Projektarbete eller Hämta från Offert
  öppnar en krysslista; valda texter ersätts, kundpriser hämtas bara efter ett
  separat val. Alla avtalsrader kan redigeras/raderas före godkännande.
  Ett godkänt avtal och dess versionskopia är låsta även i databasen.
- Betalningsplanens belopp är inte fakturerat eller betalt. Ingen faktureringsgraf
  visas innan en verklig fakturakälla finns.
- Hämta från Projektarbete i betalningsplanen öppnar ett urval av moment med
  kontrollerade positiva kundpriser inklusive moms. Importen ersätter vanliga
  delbetalningar efter ett tydligt besked, men behåller eventuella procentrader.
  Rubrik och belopp kopieras fristående; faktureringsvillkor och datum lämnas
  tomma. Ingen automatisk prisfördelning sker vid import. Avvikelse mot avtalet
  visas och kan hanteras med Anpassa till avtalets belopp. Import kan ångras
  före nästa redigering när en tidigare plan finns.
- Betalningsplanens ändringar autosparas utan en separat Spara utkast-knapp.
  Sparstatus har fast höjd och bredd, visar pågående sparning och erbjuder
  endast en återförsöksikon vid sparfel. Statusbyten får inte flytta formuläret.
- Betalningsvillkor har ett eget dagfält (30 som startvärde) och redigerbar
  ABS 18-text. Tidigare egna villkor bevaras separat. Villkor och betalplan
  sparas i samma avtalsversion; signerade och äldre versioner skrivs inte om.
- Tid för betalning i Avtal visar samma villkor och betalningsplan som
  betalplansfliken, utan extra redigerbara fält. En kompakt tabell visar moment,
  faktureringsvillkor, eventuellt datum och belopp, med summa och kontroll mot
  avtalsbeloppet. Redigera betalningsplan öppnar betalplansfliken. Fakturakund,
  Fortnox och fakturastatus ingår inte i denna sammanställning. Godkända avtal
  visar sin låsta versionskopia. Kundens dokumentlayout ändras inte.
- En ny betalplan för fast pris reserverar 10 procent som sista delbetalning.
  Slutbetalningen kan väljas bort via kryssrutan eller radens papperskorg och
  läggas tillbaka. Övriga moment delar då på återstoden proportionellt; första
  procentbetalningen behålls. Ångra återställer den tidigare fördelningen.
  En valbar första procentbetalning ligger först, efter utfört arbetsmoment.
  Krav på förskott vid beställning införs inte för ABS 18/konsument: 52 §
  konsumenttjänstlagen ger rätt att inte betala för ej utfört arbete.
- Procentrader räknas från Avtalets eget pris i ören. En prisändring räknar om
  procentraderna, inte manuella momentbelopp. Avvikelsen visas och utskick
  kräver en komplett plan vars summa stämmer med avtalet.
- Anpassa till avtalets belopp fördelar återstoden med befintliga proportioner;
  Fördela jämnt ger lika delar. Text, datum och ordning bevaras. Ångra finns
  för fördelningar inom samma format. Äldre planer uppgraderas endast genom
  ett uttryckligt val, inte i bakgrunden. Automatik kräver ett känt fast pris.
- Val/tillval ligger separat från grundavtalet. Planering är ingen beställning.
- Tidsplan visar en manuellt redigerad lista med moment, projektdel, start, slut
  och status. Moment kan hämtas från Projektarbete utan att befintliga datum ändras.
  Intern sparning och delning med beställaren är separata handlingar. Avtalstider
  och beslutsdatum visas separat. Beroenden och automatisk planering är senare steg.
- Dokumentåtkomst och delning använder befintliga behörighetsregler.
- Äldre /kund-länkar leder till samma projekts interna arbetsyta.
- Den interna projektmenyn och projekthuvudet ska inte följa med vid utskrift.

## Avtals-PDF

Detta är ett uttryckligt dokumentbeslut 2026-10-11, inte en automatisk följd
av arbetsytans visuella profil. Offert, kundgodkännande och sparade avtalsdata
ändras inte. Den befintliga gemensamma PDF-motorn används.

- Vit A4, lokalt inbäddad Manrope, grafittext och varmgula huvudrubrikband,
  tydligt skilda från grå tabellhuvuden. Avtalstyp och avtalsgrund är tydliga
  på första sidan. Varje huvudavsnitt har en tunn sammanhängande ram.
- Vänsterställd brödtext 11 pt, radavstånd 1,4 och högst 420 pt textbredd.
  Detta är användarens uttryckliga justering av det tidigare 12 pt-provet,
  inte en generell regel för tillgängliga dokument. Tabeller använder
  ramens hela inneryta, 10,5 pt, tydliga radlinjer och högerjusterade belopp.
- Huvudavsnitt har numrerat rubrikband och PDF-bokmärke. Nummer och rubrik
  är lika stora, 13 pt. Underrubriker har eget ljust band med gul vänsterlinje och
  beskriver innehållet; arbetsdelarnas namn hålls ihop med början av texten.
  Omfattning, förutsättningar och undantag har egna samlade avsnitt.
- Ingen tryckt utkaststatus, intern revision, framställningsrad eller
  varningsruta. Status och filproblem hör till appen, inte avtalstexten.
  Sidfoten visar endast sidnummer. Tomma uppgifter får skrivlinjer,
  men okontrollerad F-skatt visas med omarkerade Ja/Nej-rutor,
  oplanerade datum tomma celler. Egna formuleringar ändras inte.
- Pris visas under Priset, inte i en andra ruta på första sidan.
  Betalningsvillkor per rad ligger efter betalplanens summa. Slutbetalningens
  sparade villkor trycks utan tillagt radnummer eller titel. Texten redigeras
  i betalningsplanens befintliga fält Villkor för fakturering. Underskrifter
  hålls samman och Ort och datum får tydlig luft under rubrikbandet.
- Separata bilagor identifieras i en gemensam handlingstabell. Sparat
  handlingsnamn trycks utan dubblerat tekniskt filnamn; filnamn används bara
  när handlingsnamnet saknas eller bilagan inte har en egen handlingsrad. Sparade
  referenser och filskydd behålls även när en helt tom rad inte trycks.
  Ingen intern instruktion om filhämtning används som avtalstext.
- Ny layout gäller bara nya PDF-renderingar. Tidigare arkiverade versioner
  skrivs inte om. Bokmärken innebär inte att PDF/UA eller skärmläsarstöd
  är verifierat; teknisk dokumenttillgänglighet är ett separat arbete.

Läsbarhetsunderlag: [Isofs vägledning](https://www.isof.se/svenska-spraket/klarsprak/klarsprakshjalpen/skriv-klarsprak/ge-texten-ett-lasvanligt-utseende)
och [GOV.UK:s dokumentvägledning](https://www.gov.uk/guidance/publishing-accessible-documents).

## Beslutslogg

- 2026-10-19: Prisredigering i Val och tillval ska fungera som Projektarbete,
  med egna kalkylrader och direkt omräkning inom alternativet. Ingen ändring
  får föras över till avtalet. Offertens och avtalets befintliga funktioner
  behålls. Äldre manuella priser ändras inte bara för att panelen öppnas.

- 2026-10-11: Efter nästa PDF-prov begär användaren varmgula huvudrubriker,
  lika stora avsnittsnummer, tydliga ramar och underrubriker, starkare
  tabellinjer och något mindre brödtext. Det nya 11 pt-provet ersätter
  föregående 12 pt-layoutbeslut; rubrikerna minskas inte. Dubblerade filnamn
  och slutbetalningsvillkorets automatiska etikett tas bort endast i utskrift.
  F-skatt får tydliga, omarkerade val när status inte är kontrollerad.
  Avtalstexter, belopp, behörigheter och arkiverade PDF:er ändras inte.

- 2026-10-11: Efter granskning av avtals-PDF begär användaren en läsbar
  dokumentlayout utan interna statusrader och systemets tomfältstexter.
  Detta ersätter tidigare beslut att märka olåsta PDF:er med Ej låst och
  skriva ut bilagevarningar. Appens varningar, låsning och filskydd kvarstår.
  Omfattning och undantag grupperas, första sidans prisruta tas bort och
  betalvillkor flyttas under tabellens summa. Alla sparade egna texter bevaras.

- 2026-10-11: Användaren godkänner ett separat val av signeringssätt och
  uttrycklig delning till beställaren. På papper/annan tjänst använder låst
  PDF; Digitalt godkännande med e-postkod använder befintligt kodflöde, inte
  BankID. Autospar och PDF-låsning gör aldrig avtalet synligt för beställaren.
  Dela med beställaren visar endast den låsta versionen och dess bilagor.
  Delbar länk får en fryst PDF-kopia utan strukturerade personnummer.
  Underskriven kopia registreras internt efter manuell kontroll av samtliga
  parters underskrifter. Registrering låser versionen permanent men är inte
  en digital identitetskontroll. Digitalt stöd för två beställare återstår.
  SQL `_03_optional_contract_locking` och `_04_contract_signing_delivery`
  behövs före publicering. Befintliga avtal och kundutskick skrivs inte om.

- 2026-10-11: Användaren ändrar låsningsregeln: inga avtalsfält behöver vara
  ifyllda för extern/papperssignering. Krav på innehållskomplettering tas bort
  i gränssnitt, server och databas för denna låsning, inte för digitala utskick.
  Hämta PDF för signering ska vara synlig före låsning. Ett olåst dokument märks
  Ej låst; efter låsning hämtas alltid den oföränderliga arkiverade PDF:n.
  Autospar måste vara klart, och behörighet, revisions- och filskydd kvarstår.

- 2026-10-11: Användaren begär låsning och PDF för extern/papperssignering.
  Avtal återanvänder HusHubs befintliga React PDF-renderare via en gemensam
  hjälpfunktion, med en egen avtalsmall. Låsning är inte signering eller
  kundgodkännande och skickar inget mejl. Den låsta versionens texter, priser,
  betalningsplan och bilagekopior är oföränderliga. Ett uttryckligt nytt utkast
  bevarar tidigare PDF-versioner. Två beställare får egna underskriftsrader.


- 2026-10-11: Användaren begär praktiska avtalsförutsättningar för el,
  ombyte och matplats med mera. Införs under Övrigt, med uttryckligt ansvar,
  kostnadsansvar och plats/villkor per punkt. Signerade versioner behålls.
- 2026-10-10: Användaren godkänner att Tid för betalning visar en skrivskyddad,
  kompakt sammanställning av betalningsplan och villkor, med summakontroll.
  Redigering sker endast i betalplansfliken och använder samma avtalsutkast.
- 2026-10-10: Användaren godkänner tydliga gränser för öppna avtalssektioner:
  tonad rubrikrad, sammanhängande grönblå vänsterlinje och markerat avslut.
  Interna huvudsektioner får denna markering; befintliga underlistor behålls.
- 2026-10-10: Användaren vill ha en gemensam prisvy i Avtal som följer
  Redovisning i avtalet. Den dubbla förhandsvisningen tas bort och inställningar
  ordnas före tabellen. Dolda delmoment kan fortfarande redigeras uttryckligen.
- 2026-10-10: Användaren begär hämtning från Projektarbete i betalningsplanen.
  Genomfört med enkelt momenturval, fristående kopior och uttrycklig ersättning
  av vanliga delbetalningar. Kontrollerade kundpriser används, inte interna kostnader.
- 2026-10-10: Användaren påpekar att tillagd slutbetalning inte går att ta bort.
  Slutbetalning 10 procent blir ett reversibelt val. Äldre planer behåller sin
  slutbetalning tills användaren väljer bort den; sparade avtalsversioner bevaras.
- 2026-10-10: Användaren tar bort betalningsplanens överflödiga sparaknapp.
  Befintligt autosparande behålls; sparstatus visar köad/pågående sparning,
  sparat eller fel utan layoutförskjutning. Återförsök finns vid sparfel.
- 2026-10-10: Användaren begär betalningsdagar, valbar första procentbetalning,
  automatisk slutbetalning 10 procent och avstämning mot avtalspriset.
  Genomförs med kompakta öppningsbara rader och bevarade egna villkor.
  Förskott vid beställning är en öppen fråga: juridisk konflikt har lyfts;
  implementationen använder första delbetalning efter utfört arbete.
- 2026-10-10: Användaren godkänner strukturerade ÄTA-prisgrunder med flera
  timpriser, påslag per kostnadsslag eller en versionerad prisbilaga. Valet
  är oberoende av grundpriset och innebär ingen beställning av en faktisk ÄTA.
  Befintliga egna texter och signerade avtalsversioner ändras inte automatiskt.
- 2026-10-10: Användaren vill ha mindre luft genom hela avtalssidan och
  inte full bredd på varje fält. Intern Avtal får en begränsad arbetsbredd,
  tätare rader, formulär och verktyg. Innehåll, autosparning, låsning,
  importregler, kundens dokument och andra moduler är oförändrade.
- 2026-10-08: Användaren godkänner prisvisualiseringen enligt ABS 18. Avtalets
  prisrader blir oberoende av omfattningstexterna och av offertens interna
  kalkyl. Vald prisredovisning styr även vilka belopp som delas till beställaren.
  Klumpsummor bevaras vid uppgradering och fördelas inte automatiskt på moment.
- 2026-10-08: Användaren tar bort Övriga bilagor. Handlingsförteckningen är
  enda platsen för bilageval i Avtal. Tidigare valda bilagor behålls som rader,
  utan gissad typ eller datum; befintliga handlingsuppgifter skrivs inte över.
- 2026-10-08: Masshantering av avtalsrader införs: välj enskilda eller alla,
  rensa markering, radera valda eller ändra Ingår som. Ingen massredigering
  av fritext eller priser. Åtgärder använder avtalsutkastets befintliga
  autosparning och låsning, inte projekt-/offerttabellerna. Avgränsningar
  saknar kundpris enligt befintlig prisregel; detta framgår före bekräftelse.
- 2026-10-08: Användaren beslutar att Avtal ska ha helt egna texter och egen
  databaslagring, låsta vid godkännande. Arbetsdelar blir kompakta öppningsbara
  rader med fri redigering och borttagning. Import kan ske från Projektarbete
  eller sparad Offert och skriver bara över uttryckligen valda rader.
  Projektnavigeringen flyttas till registerflikar överst. Avtalsstatus flyttas
  till en hopfällbar fullbreddsrad för att frigöra formulärets bredd.
- 2026-10-07: Användaren förenklar importen till Hämta från projektdata under
  Arbetsdelar och avgränsningar. En minimerad öppnare visar en kompakt krysslista
  enligt Tydlig tabell: Välj alla eller enskilda arbetsdelar, sedan Hämta och ersätt.
  Jämförelse, filter och val per textfält tas bort. Endast valda raders texter
  ersätts. Vid oklar äldre koppling väljs ersättningsrad, inte en osäker gissning.
  Kundpriser behålls som standard och navigation skriver aldrig över kundtexter.
- 2026-10-07: Användaren beslutar att ABS 18:s allmänna bestämmelser ska
  följa med automatiskt när ABS 18 väljs. Original-PDF och frysta versionskopior
  används; projektspecifika texter och egen avtalshandling behålls separat.
- 2026-10-07: Handlingsförteckningen komprimeras enligt den befintliga
  varianten Tydlig tabell efter användarens återkoppling. Det är samma
  Gizmo-profil, inte ett nytt formspråk. Autosparning, dokumentåtkomst,
  avtalsvillkorsroll och publicerade avtalsversioner är oförändrade.
- 2026-10-06: Användaren väljer **Tydlig tabell** för Projektarbete: tonad
  rubrikrad, tydligare åtgärdsnamn, raka avdelare samt peknings-/valmarkering.
  Gizmos färger, innehåll, sidopanel och befintligt autosparande behålls.
- 2026-10-06: Klickrespons och laddningsgränser införs i Uppdrag enligt den
  befintliga standarden från ÖB/EB. Interna vybyten är fortsatt direkta och
  behåller utkast. Projektöppning hämtar kontaktlistan utan uppdragshistorik
  och utför oberoende, behörighetsavgränsade läsningar samtidigt.
- 2026-10-01: Offert, val/tillval och delbetalningar får kompakta sammanfattningsrader.
  En rad öppnas åt gången; nya rader öppnas direkt. Att fälla ihop sparar inte och
  raderar inte något. Sammanfattningen visar rubrik, relevant status/datum och pris.
  Inmatning kan fortsätta under sparning; senare ändringar förblir osparade och
  ersätts inte av ett äldre serversvar. Samlat åtgärdspris är ett aktivt val,
  inte fiktiva timmar. Detaljrader bevaras utan att dubbelräknas.
- 2026-10-01: Manuell produktionsplan godkänns som ett första steg. Projektdel är
  fri text med förslag såsom Mark, Grund och Stomme, inte en ny obligatorisk
  projektstruktur. Delning ändrar inte avtalets låsta tider.
- 2026-10-01: Användaren godkänner projektlista och gemensam projektnavigering nu,
  inte längre som enbart framtida riktning. ÖB:s formspråk är förebild, Gizmos
  färger och identitet behålls. Befintliga funktioner återanvänds.
- Tidigare namnändring till Projektarbete kvarstår inne i projektet.
  Listnivån heter Projekt för att skilja val av projekt från arbete i projektet.

## Verifiering före publicering

Handlingsredigering ska ha ett lokalt utkastsskydd enligt ÖB:s princip, med
projekt- och flikavgränsning. Normal sparstatus behåller sin fasta yta. Ett lokalt
utkast efter en konflikt visas där med en återställningsikon och förklarande
tooltip; tillfälliga besked går genom HusHubs toastsystem. Nyare serveruppgifter
får inte ersättas utan ett uttryckligt val. Godkända avtal återställs inte.

Kontrollera listval, sökning, filter, tomläge, direktlänk och webbläsarens tillbaka.
Prova osparat offertutkast och planering genom alla projektdelar, betalningsplan,
åtgärdspanel, filvisning och skrivskyddad beställarförhandsgranskning. Kontrollera
dator, mobil och tangentbord, samt att inga utskick sker enbart genom navigering.

### Arbetsplatsens förutsättningar 2026-10-11

- Åtta valfria rader under Övrigt, utan förvalt ordnande eller kostnadsansvar.
  Aktiva uppgifter följer med avtalsgranskningen; tomma punkter utelämnas.
- 441 action-case-regressionstester passerade efter de sista ändringarna i
  rensning och låsskydd, inklusive åtta riktade tester. TypeScript,
  riktad ESLint och den lokala komponentfixturens webpack-bygge passerar.
- Databasprovet kör migrationen två gånger, behåller äldre utkast/versioner,
  kontrollerar revisions- och organisationsgränser, avvisar äldre klienters
  borttappade uppgifter, tillåter uttrycklig rensning och låser efter godkännande.
- Lokala klicktester med fiktiva uppgifter: skilda ansvarsval, flera rader,
  autospar, sparfel/återförsök, omladdning och skrivskyddad avtalsgranskning.
  Tangentbord och 390/344 px mobilbredder kontrollerade utan sidöverflöde.
  Mobilkontrollen använder en fastbreddsiframe i testfixturen eftersom
  webbläsarverktygets viewport-inställning inte slog igenom på den dolda fliken.
- Migration `2026-10-11_01_contract_site_facilities.sql` är körd av användaren.
  Skrivfria produktionskontroller verifierar giltiga uppgifter, avvisning av
  felaktiga/ofullständiga uppgifter, integration i ordinarie avtalskontroll och
  nekad anonym körning. Driftsättning kontrolleras separat efter publicering.
  Inga produktionsuppgifter eller utskick ändrades vid verifieringen.

### Betalningsplan 2026-10-10

- Tid för betalning är lokalt klicktestad med fiktiva uppgifter: samma villkor,
  dagar, moment och datum visas direkt efter ändring i betalplansfliken och
  finns kvar efter omladdning. Avvikelse mot avtalsbeloppet visas; uttrycklig
  omfördelning ger samma summa i båda vyerna. Redigeringsknappen öppnar alltid
  Betalningsplan, även efter att Fakturakund använts. Tangentbord samt 390/344 px
  mobilbredder är kontrollerade utan sidöverflöde eller klippta belopp.
  Sju nya sammanställningstester och totalt 31 riktade tester passerar, liksom
  TypeScript och riktad ESLint. Ingen ny lagring, SQL eller kundutskick behövs.
  Driftsättningen kontrolleras separat vid publicering.
- Valbar slutbetalning är lokalt klicktestad: slå av/på, papperskorg, ångra,
  första procentbetalning, exakt totalsumma, ny rad sist och omladdning.
  Ångra fördelning nollställs vid senare radredigering så att ny text behålls.
  89 riktade modell-, server- och databastester samt TypeScript och ESLint
  passerar. Migration `2026-10-10_03_optional_final_payment.sql` är testad
  två gånger utan omskrivning av äldre data och måste köras före publicering.
  Ändringen är ännu inte publicerad.
- Sparaknappen borttagen i lokal testversion. Klicktest med fiktiva uppgifter
  verifierar betalningsdagar, egna villkor och en delbetalningsrad efter omladdning.
  Långsam sparning, sparfel och återförsök bevarar inmatningen; statusytan
  behåller 32 px höjd och 240 px bredd och fältets position är oförändrad.
  21 riktade tester, TypeScript och riktad ESLint passerar. Ej publicerat ännu.
- Publiceringskontroll: version `831e53d3` driftsatt på hushub.se. Båda nya
  databasfunktionerna finns och avvisar ogiltig inmatning genom de ordinarie
  avtals- och betalplanskontrollerna. Befintligt avtalsutkast kan läsas med
  den nya modellen; inga utskick eller signeringar görs i kontrollen.
- Produktionskontrollen upptäckte sidöverflöde i smalt datorfönster från
  dashboardens flexbehållare. Den får `min-width: 0` endast på Uppdrag-rutter.
  Testvyn inkluderar nu motsvarande yttre behållare. Avtal, ÄTA och betalplan
  provas med 900/390/1280 px fönster utan sidöverflöde. Viewporten återställs.
  418 action-case-tester, 34 riktade tester inklusive organisationskontext,
  TypeScript, ESLint och produktionsbygge passerar efter rättningen.
- Klicktest med fiktiva data: äldre plans avvikelse mot nytt avtalspris,
  uttrycklig reservation av slutbetalning 10 procent, första betalning
  10/20 procent, betalningsdagar, omfördelning, lika fördelning och ångra.
- Prisändring uppdaterar procentrader, behåller manuella momentbelopp och
  visar skillnaden. Anpassning ger exakt avtalssumma; text, datum och ordning
  bevaras. Slutbetalningen ligger alltid sist och procentradernas belopp är
  skrivskyddade. Ta bort/ångra vanlig delbetalning är kontrollerat.
- Villkor och belopp överlever omladdning. Simulerat sparfel behåller
  inmatningen och återförsök fungerar. Avtalsgranskningen innehåller både
  valda betalningsdagar, standardtext och tidigare egna villkor.
- Datorns arbetsyta är högst 1080 px med cirka 54 px sammanfattningsrader;
  mobilbredder 390/344 px saknar sidöverflöde. Mobilfält har 16 px text och
  minst 48 px tryckyta. Viewporten återställs efter testen.
- 417 action-case-regressionstester passerar, därefter 12 riktade modell-
  och layouttester. TypeScript, riktad ESLint och produktionsbygge med
  webpack passerar. SQL provas två gånger: validering, gamla klienters
  skrivskydd, publiceringskrav, frysta avtalsversioner och signeringslås.
- Migration `2026-10-10_02_payment_plan_automation.sql` behövs före
  driftsättning. Ingen produktionsdatabas eller riktig kundkommunikation
  används i testerna. Förskottsfrågan är ännu inte en godkänd produktregel.

### ÄTA-prisgrunder 2026-10-10

- Klicktest med fiktiva data: flera timpriser, separat arbetsledning,
  radering med bekräftelse, fyra kostnadspåslag och redigerbara avtalsvillkor.
- Prisbilagan förekommer en gång i handlingsförteckningen. Namn, datum och
  version överlever omladdning. Byte av prisgrund behåller egna timpriser i
  utkastet men visar bara den valda prisgrunden i kundens avtalsutkast.
- Simulerat sparfel behåller uppgifterna. Återförsök och omladdning fungerar;
  sektionens position och höjd ändras inte när sparstatusen ändras.
- Normal datorvy och mobilbredder 390/344 px kontrollerade utan sidöverflöde.
- 407 action-case-regressionstester passerar. Därefter passerar även de 19
  riktade modell- och databastesterna med svensk decimalvisning. TypeScript
  och riktad ESLint passerar. Produktionsbygget med webpack och projektets
  befintliga lokala miljöinställningar passerar också.
- SQL-migrationen provas lokalt två gånger utan att skriva om tidigare
  avtalsversioner. Validering, filägarskap, publiceringskrav och signeringslås
  kontrolleras. Migrationen måste köras före publicering av gränssnittet.
- Ingen produktionsdatabas, kundkommunikation eller riktig signering används.

### Kompakt Avtal 2026-10-10

- Intern arbetsyta kontrollerad vid 1440 px: högst 1080 px bredd, 44 px
  prisrader, 32 px prisverktyg och 36 px inmatning/kommandon. Datumfält är
  högst 220 px; handlingsdatum ryms på en rad. Längre texter är redigerbara
  och textfälten kan göras högre, utan att någon avtalsinformation tas bort.
- Klickkontroll med fiktiva uppgifter av sektioner, prisredigering,
  handlingsredigering och byte till blandad prisform. En prisändring överlevde
  omladdning. Sparfel/återförsök behöll inmatningen och sparstatusens fasta höjd.
- Mobil 390 och 344 px kontrollerad utan sidöverflöde eller klippta fält;
  inmatning och verktyg är minst 48 px höga med 16 px inmatningstext.
- 396 action-case-tester, TypeScript och riktad ESLint passerar. Nya
  layouttester skyddar avgränsningen till intern Avtal och responsiva mått.
- Ingen SQL-migrering, produktionsdata eller kundutskick ändrades.
  Denna layout är lokalt verifierad; driftsättning verifieras separat.

### Låsning och avtals-PDF 2026-10-11

- Senare korrigering enligt användarbeslut: låsning kräver inga ifyllda texter,
  namn, priser, handlingsdatum eller balanserad betalningsplan. Granskning av
  innehållet är användarens ansvar; låsningen är inte ett intyg om fullständighet.
- Hämta PDF för signering finns direkt under Avtalsstatus, oberoende av låsning.
  Det olåsta dokumentet använder sparade avtalstexter och har underskriftsrader,
  men arkiverar inget, låser inget och skickar inget. Ingen live-projekttext eller
  ny standardtext läggs in vid hämtningen. Gamla låsta PDF:er återskapas aldrig.
- Uppföljningsmigration: `docs/db/2026-10-11_03_optional_contract_locking.sql`.
  Den ersätter endast låsningsfunktionen och ändrar inga utkast eller arkiv.
  Tidigare migration och digitala publiceringskrav behålls.
- Korrigeringen är lokalt verifierad med 456 action-case-tester, separat
  PDF-regression för EB, TypeScript, riktad ESLint och produktionsbygge.
  Tomt ABS 18-utkast och ofullständiga fält/handlingsdatum kan låsas i databastest.
  PDF före låsning, låsning, omladdning, nytt utkast och oförändrad gammal PDF
  är klicktestade med fiktiva uppgifter. Fyra A4-sidor och mobil 390/344 px
  är kontrollerade. Publiceringskontroll 2026-10-11 verifierar `_03` och `_04`
  i produktionsdatabasen: exakta funktionsdefinitioner, RLS, privata rättigheter
  och aktiva triggers. Kontrollen ändrar inga avtals- eller kunduppgifter.
- Under Avtalsstatus finns PDF och signering: Lås för signering, uttrycklig
  bekräftelse, Hämta PDF och Skapa nytt utkast. Låsta bilagor hämtas separat;
  PDF:n redovisar bilageförteckningen, men bäddar inte in originalhandlingarna.
- En separat versionstabell och privata lagrade PDF-filer används. Nedladdning
  kontrollerar organisation, uppdrag, filstorlek och SHA-256; ingen aktuell
  projekttext eller ändrad standardtext används för att återskapa gamla versioner.
- Låsta utkast och betalningsplaner är skrivskyddade även i databasen. Samtidiga
  ändringar nekas med revisionskontroll. Ett publicerat digitalt avtal måste
  återkallas innan pappersversionen kan låsas. Befintliga godkännanden ändras inte.
- Ny migration: `docs/db/2026-10-11_02_contract_signing_documents.sql`, efter
  arbetsplatsförutsättningarna. Saknad migration visar en aktiveringsnotis;
  sparade utkast kan fortfarande användas. Migrationen ändrar ingen äldre data.
- Lokalt verifierat med syntetiska uppgifter: låsning, omladdning, PDF-hämtning,
  skrivskyddad betalningsplan och nytt utkast med byte-identisk tidigare PDF.
  A4-utskrift med fyra respektive tio sidor kontrollerad för text, sidbrytningar,
  sidnummer och underskrifter. Ingen riktig kund eller signering har berörts.
- Produktionsbygge, TypeScript, riktad ESLint och 451 action-case-tester passerar.
  Databasbehörigheter och fel/retry-flöden testas lokalt. Migrationen finns i
  produktion: tabellen svarar, RPC:n nekar fel organisationskontext och anonym
  tabellåtkomst är nekad. Kontroll gjord utan att låsa eller ändra något avtal.
  Driftsättningen verifieras separat mot publicerad commit.

### Handlingsförteckning 2026-10-07

- Ingår i publiceringspaketet enligt Tydlig tabell. Datorns
  standardrader är 60 px; rubrikradens färg är #EDF1F1 med 12 px/vikt 600.
  Den öppna raden använder #FFF7D6. Markeringar ändrar inte radens dimensioner.
- Tangentbord, radbyte, omordning, autosparning under fortsatt inmatning,
  sparfel/återförsök och omladdning är klicktestade med fiktiva data.
  Mobil 390 och 344 px är kontrollerad utan sidöverflöde eller klippta fält.
- 305 action-case-regressionstester, TypeScript, riktad ESLint och
  produktionsbygge passerar. Ingen databas eller publicerad avtalsversion ändras.

### Navigationskontroll 2026-10-06

- 215 automatiserade action-case-tester, TypeScript, riktad ESLint och
  produktionsbygget passerar.
- En lokal Next-produktionsfixtur använder de riktiga komponenterna med fiktiva
  uppgifter och sex sekunders serverfördröjning. Klick och Enter visar omedelbart
  laddningsläget; tillbaka och återöppning fungerar.
- Ett simulerat serverfel visar ett bestående fel med återförsök. Återförsöket
  hämtar nya serverdata och öppnar projektet när felet försvunnit.
- Interna vybyten och webbläsarens tillbaka bevarar osparat offertutkast.
- Projektlistan kontrollerad på dator och vid 390 px mobilbredd utan sidöverflöde.
  Mobilklick visar samma laddningsläge.
- Ingen produktionsdata, SQL eller något utskick ändrades. Verklig svarstid på
  hushub.se återstår att mäta efter publicering.

### Åtgärdslista och sparstatus 2026-10-06

- Tydlig tabell kontrollerad i lokal testversion med produktionskomponenterna:
  tonad rubrikrad, raka 60 px-rader, markerad öppen åtgärd och tangentbordsfokus.
- Enter öppnar sidopanelen; Escape återför fokus till samma rad. Ny åtgärd och
  byte till Kalkyl efter en omfattningsändring fungerar fortsatt.
- Vid 390 px bredd staplas uppgifterna och långa namn bryts utan sidöverflöde.
- Autosparande visar inte längre en tillfällig rad ovanför listan. Sidfotens
  höjd är stabil vid väntan, sparat, sparfel och saknad rubrik. Sparfel behåller
  utkastet och kan återförsökas efter att sidopanelen har stängts och öppnats.
- 220 automatiserade action-case-tester, TypeScript och riktad ESLint passerar.
  Produktionsbygget passerar. Ingen produktionsdata eller något kundutskick
  ändrades i testerna. Driftsättning verifieras separat mot publicerad commit.

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

### Kompakta projektredigerare 2026-10-01

- 188 automatiserade action-case-tester passerar, inklusive SQL-test av de nya
  migrationerna, organisationsgränser, revisionskonflikter och privata/delade planer.
- Lokal CUA-klickkontroll av sammanfattningsrader, fortsatt inmatning under sparning,
  sparfel/nytt försök, omordning och ta bort/ångra delbetalning.
- Samlat pris och uttrycklig överföring till offert provade, inklusive moms.
- Tidsplan: valbar import, sparning och uttrycklig delning provade. Senare interna
  ändringar ersatte inte den delade planen i beställarförhandsgranskningen.
- Bildminiatyrens laddade pixlar samt öppning i fullformat kontrollerade.
- Inga riktiga kunduppgifter, avtal eller utskick ändrades i dessa lokala tester.
- Publiceringskontroll 2026-10-01: båda nya migrationerna körda i produktion.
  Tidsplanens RLS och nekad klientåtkomst verifierade, liksom service-rollens RPC
  och den validerade databaskontrollen för samlat pris. Inga befintliga avtal ändrades.
