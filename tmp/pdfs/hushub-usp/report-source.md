# HusHubs starkaste säljargument
## Rekommenderad positionering
6 september 2026 • Beslutsunderlag för HusHubs produkt- och marknadsarbete

**Slutsats:** Lyft vad användaren slipper göra och får bättre grepp om. AI och digitala formulär är viktiga funktioner, men inte i sig belagda unika fördelar. HusHubs starkaste nuvarande berättelse är mindre dubbelarbete för besiktningsmannen och konkret hjälp genom ansökan och granskning för boende och styrelse.

### BesiktApp: mindre efterarbete, bättre ordning
**Förslag till huvudbudskap: ”Lägg mindre tid på att skriva ihop besiktningen.”** Uppgifter förs vidare från uppdragsbekräftelsen, bilder kopplas till noteringar och tidigare besiktningar går att hitta. Det är konkreta mekanismer bakom tidsbesparingen, inte en uppmätt effekt. [Kodunderlag: ÖB-konvertering](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/assignments/server.ts#L1767).

### RenoApp för styrelsen: stöd i själva granskningen
**Förslag till huvudbudskap: ”Se vad som behöver granskas - och varför.”** Styrelsen kan se grunden för föreslagna underlag, öppna granskningsvägledning och välja vad som ska begäras in. Detta säger mer än ”digital ärendehantering”. Hjälpens omfattning beror på vilka texter som finns registrerade. [Kodunderlag: granskningsvyn](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/app/cases/%5Bid%5D/RenoAppCaseDecisionView.tsx#L263).

### RenoApp för den boende: hjälp att komma vidare
**Förslag till huvudbudskap: ”Få hjälp att ansöka om din renovering.”** Frågor och föreslagna underlag anpassas efter renoveringen och svaren. Ett utkast kan sparas och senare kompletteras via en personlig länk, utan boendekonto. [Kodunderlag: ansökningsflödet](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/brf/%5Bslug%5D/apply/page.tsx#L389).

### Håll isär dagens erbjudande och nästa steg
Personlig hjälp är **kommande**, enligt ditt förtydligande i samtalet. Dagens erbjudande är inbyggd vägledning och granskningsstöd. En gemensam fastighetsjournal och kopplingen vidare till underhållsplanen är en utvecklingsriktning, inte en belagd färdig helhet.

*Läsnyckel: Funktionerna har granskats i lokal kod vid commit 60ce844. Kundnyttan är vår bedömning av funktionerna. Mätbar effekt, produktionens konfiguration och överlägsenhet mot konkurrenter är inte verifierade.*

<!-- PAGE -->
## BesiktApp: fördelar utöver ”AI och tidsbesparing”

### 1. Slipp skriva in samma uppgifter igen
Adress, kunduppgifter, datum och uppdragsnummer kan följa med från ÖB-uppdragsbekräftelsen till besiktningen. **Säljnytta:** mindre dubbelregistrering före arbetet, inte bara snabbare rapportskrivning efteråt. Gäller det verifierade ÖB-flödet, inte samtliga moduler. [ÖB-konvertering](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/assignments/server.ts#L1816).

### 2. Hitta rätt underlag när kunden ringer
Sök på adress, kund, uppdragsnummer eller status. Öppna tidigare besiktning och återvänd till dokumentationen. **Säljnytta:** lättare att hantera följdfrågor utan att börja leta från noll. Detta är dagens användbara del av exemplet med frågan om fuktfläcken. [Sökning och filtrering](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/%28dashboard%29/inspections/page.tsx#L603).

### 3. Bilder som hör ihop med iakttagelsen
Rum, våningsplan eller byggdel ger bilderna sammanhang. Bilder kopplade till kontrollpunkter används i rapportmappningen. **Säljnytta:** mindre arbete med att i efterhand identifiera var en bild togs och vad den visar. [Bild- och rapportkoppling](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/report/pdfV2/buildReportDataV2.ts#L1090).

### 4. Återanvänd kunskap i stället för att börja om
Kontrollpunkter och valbara utfall kan ge förslag till notering, risktext och fortsatt teknisk utredning. **Säljnytta:** stöd för en mer konsekvent dokumentation. ÖB:s verifierade AI-sökning hjälper till att hitta kontrollpunkter; den utför inte besiktningen. [Utfall och textmallar](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/components/ob/ObStepInsida.tsx#L4452).

### 5. AI-stöd där du behåller kontrollen
I **Tekniska utredningar, TU**, finns rapportförslag som kan granskas, avvisas och ångras. Källvarningar kan stoppa användning i revideringsflödet. TU har även röstanteckningar med transkribering. **Säljnytta:** skrivhjälp med en uttrycklig mänsklig granskningspunkt. Inte en garanti för korrekta AI-svar och inte samma funktion i ÖB eller EB. [Rapportgranskning](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/components/tu/TuReportReviewDrawer.tsx#L268), [röstanteckning](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/components/tu/TuFieldEntryComposer.tsx#L144).

### 6. Ett tydligt avslut med ditt företag som avsändare
ÖB har förhandsgranskning, rapportutskick och val att klarmarkera och låsa. Företagsuppgifter och logotyp kan följa med i rapporten. **Säljnytta:** mindre separat filhantering och ett enhetligare kundintryck. Utskick kräver fungerande konfiguration. [Leveransflöde](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/components/ob/ObWizard.tsx#L720), [rapportprofil](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/report/pdfV2/buildReportDataV2.ts#L1366).

*Prioritera på hemsidan: mindre dubbelarbete, bilder/noteringar till utlåtandet och sökbara tidigare besiktningar. Visa modulernas konkreta AI-funktioner längre ned eller i en demo.*

<!-- PAGE -->
## RenoApp: vad styrelsen faktiskt får hjälp med

### 1. Förstå varför ett underlag föreslås
Styrelsen kan se vilket svar eller vilken renoveringstyp som ligger bakom förslaget. **Budskap: ”Se varför handlingen behövs i granskningen.”** Det är en förklarad rekommendation, inte ett automatiskt juridiskt krav. [Förslagets grund](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/app/cases/%5Bid%5D/RenoAppCaseDecisionView.tsx#L263).

### 2. Få hjälp där bedömningen ska göras
Granskningsvägledning finns vid underlag och aktörer när text registrerats. Styrelsen väljer själv att begära eller inte begära in ett föreslaget underlag. **Budskap: ”Stöd i granskningen. Ni fattar beslutet.”** Innehållets täckning behöver kontrolleras innan vi lovar stöd för varje situation. [Granskningsstöd](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/app/cases/%5Bid%5D/RenoAppCaseDecisionView.tsx#L634).

### 3. Be om just det som saknas
Kompletteringsflödet fokuserar på efterfrågade dokument och aktörer. Befintliga handlingar ligger kvar. **Budskap: ”Begär en komplettering och fortsätt i samma ärende.”** Möjlig nytta är färre onödiga turer, men minskad kompletteringstid är inte uppmätt. [Kompletteringsflöde](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/brf/%5Bslug%5D/apply/page.tsx#L900).

### 4. Ärendena finns kvar när styrelsen byts
Historiken visar händelser, tidpunkt och avsändare. Föreningen kan ha flera personliga styrelseanvändare. **Budskap: ”Samla ärendena i föreningen, inte i en ledamots inkorg.”** Mindre personberoende är en viktig möjlig nytta, även om det inte finns en separat överlämningsfunktion. [Ärendehistorik](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/app/cases/%5Bid%5D/RenoAppCaseDecisionView.tsx#L1092), [användarhantering](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/app/users/page.tsx#L288).

### 5. Gå tillbaka till vad ni beslutade
Beslut, motivering och eventuella villkor sparas i ärendet och beslutet registreras i historiken. **Budskap: ”Hitta beslutet och villkoren tillsammans med ansökan.”** Detta är dokumentation, inte juridisk signering eller en garanterat oföränderlig logg. [Beslutssparande](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/renoapp/server.ts#L8493).

### 6. Se vilka ärenden som väntar
Ärendelistan har sökning, statusfilter och antal. Personliga mejlinställningar styr aviseringar för bland annat nya ansökningar och kompletteringar. **Budskap: ”Få överblick över pågående ärenden.”** Lova inte automatisk bevakning av alla tidsfrister eller att varje beslut alltid mejlas. [Ärendelista](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/app/cases/page.tsx#L488), [händelseavisering](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/renoapp/server.ts#L4735).

*Prioritera på hemsidan: förklarade underlagsförslag, stöd i granskningen och kompletteringar i samma ärende. Använd mindre personberoende som ett starkt föreningsargument längre ned.*

<!-- PAGE -->
## Den boendes nytta och HusHubs nästa möjlighet

### Fyra fördelar för den som ska renovera
- **Du börjar med vad du vill göra.** Frågor och underlagsförslag anpassas efter val och svar. Nyttan är mindre behov av att själv utforma en ansökan.
- **Du får hjälp att förstå vad som efterfrågas.** Dokumentbeskrivningar och verifieringsinstruktioner visas där innehåll finns. Det är vägledning, inte en garanti att alla handlingar är rätt.
- **Du behöver inte skapa ännu ett konto.** Ansökan är publik för anslutna föreningar. Ett sparat utkast kan fortsättas via personlig länk; inledande kontaktuppgifter behövs fortfarande.
- **Du kan samla material efter hand.** Pausa utkastet och komplettera senare. Vid begärd komplettering fokuserar flödet på det styrelsen efterfrågat, inte en helt ny ansökan.

Underlag: [ansökningsflöde och instruktioner](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/brf/%5Bslug%5D/apply/page.tsx#L1672), [utkast och autosparande](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/renoapp/brf/%5Bslug%5D/apply/page.tsx#L1266), [personlig fortsättningslänk](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/renoapp/server.ts#L4795).

### HusHub i dag: använd rätt verktyg för ditt arbete
En besiktningsman kan arbeta i ÖB utan att genomföra en renoveringsansökan eller underhållsplan. Produkter och moduler har separata ingångar. **Det är ett bra argument för enkel start**, inte ett löfte om att alla andra funktioner är osynliga: dashboarden visar även modulkort utan behörighet. Inget påstående görs om fria produktpaket eller priser. [Modulindelning](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/app/%28dashboard%29/dashboard-v1/page.tsx#L11).

### Framtida möjlighet 1: personlig hjälp i ärendet
När den lanseras kan användaren få hjälp av en människa när instruktionerna inte räcker. Det kan stärka erbjudandet, men är **inte en befintlig funktion**. Före marknadsföring behöver omfattning, kompetens, svarstid, pris och ansvar vara tydliga. Användarens besked styr denna klassning; nuvarande villkor beskriver sakkunniggranskning som separat tillägg. [Tjänstens villkor](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/renoapp/brfTerms.ts#L43).

### Framtida möjlighet 2: från iakttagelse till uppföljning
Besiktningen kan bli startpunkten för ett fortsatt ärende om exempelvis en fuktfläck. Kundens frågor, nya bilder och en eventuell utredning kan då hänga ihop med ursprungsunderlaget. **Detta är en föreslagen utvecklingsriktning**, inte dagens verifierade sammanhållna flöde.

### Framtida möjlighet 3: ett hus med en användbar historik
Att föra vidare relevanta resultat till fastighetens dokumentation och underhållsplan ligger nära ursprungsidén. Värdet kan bli mindre återinsamling och bättre kontinuitet. Först behövs fungerande objektkopplingar, tydlig åtkomst och praktiska uppföljningsflöden. Dagens ÖB-konvertering skapar en ny fastighetsrad och bevisar inte att detta redan är löst. [Nuvarande konvertering](https://github.com/hedbjornniklas-creator/underhallsplan-villa/blob/60ce844/src/lib/assignments/server.ts#L1816).

<!-- PAGE -->
## Vad kan faktiskt särskilja HusHub?

### Marknadsbild: viktiga funktioner är inte automatiskt unika
**Besiktningssystem:** Nspector marknadsför redan AI-stöd, foto, mallar, planering och rapportflöde. Därför bör vi visa hur BesiktApp fungerar i verkliga arbetsmoment, inte bara räkna upp ”AI, struktur och tidsbesparing”. Vi har granskat leverantörens erbjudande, inte verifierat dess effektpåståenden. [Nspector, produktsida, odaterad; läst 6 september 2026](https://nspector.se/).

**Renoveringsansökningar:** Renoveringsansökan.se marknadsför en guidad väg till en ansöknings-PDF. Brfplan beskriver även underlagsförslag, granskning och digitalt arkiv. VidaBo marknadsför ansökningar, status och styrelsehantering. Ett riktigt BRF-exempel, Kalkonen, beskriver dessutom ansökan och kommunikation i Nabos medlemsportal. **Att vara digital räcker alltså inte som särskiljande position.** [Renoveringsansökan.se](https://renoveringsansokan.se/), [Brfplan](https://brfplan.se/), [VidaBo](https://vidabo.se/funktioner/ansokningar) (produktsidor, odaterade; lästa 6 september 2026); [HSB BRF Kalkonen, 10 september 2025](https://www.hsb.se/stockholm/brf/kalkonen/nyheter/renovering-och-ombyggnation-av-din-lagenhet/).

**Personlig hjälp och en bredare hubb:** Badrumsbesiktningar beskriver ett BRF-erbjudande med granskning, teknisk support och arkivering. Dift beskriver dokumentation, ärenden och historik per fastighet. Inte heller dessa idéer ska kallas unika utan en mer specifik jämförelse. [Badrumsbesiktningar, BRF-paket](https://www.badrumsbesiktningar.se/brfpaketet), [Dift, produktsida](https://www.dift.se/) (odaterade; lästa 6 september 2026).

### Min rekommendation: välj få budskap och visa dem
- **BesiktApp:** visa ett konkret ÖB-exempel från uppdragsuppgifter och bilder till utlåtande. Lägg till en separat TU-demo av hur AI-förslag granskas.
- **RenoApp:** visa hur ett svar ger ett underlagsförslag, hur styrelsen ser orsaken och hur en komplettering kommer tillbaka till samma ärende.
- **HusHub:** håll paraplyet enkelt. ”Verktyg för besiktningar och renoveringsärenden” förklarar vad som finns; varje produkt får bära sin egen kundnytta.

### Bevis att samla innan vi gör större löften
Mät i en liten pilot: aktiv efterarbetstid per jämförbar besiktning, tid att hitta ett äldre underlag, styrelsens aktiva handläggningstid och antal kompletteringsvändor per jämförbart ärende. Testa om en ny ledamot kan förstå ett tidigare beslut och om en boende kan återuppta sin ansökan utan hjälp. Detta är föreslagna mätningar, inte befintliga resultat.

### Avgränsning
Underlaget bygger på lokal kod och projektdokument vid commit 60ce844, dina uppgifter samt riktade primärkällor. HusHub kunde inte läsas via webbläsningsverktyget i denna research; ingen ny produktions- eller inloggningstest har gjorts. Databasens hjälptexter, kundutfall, juridisk riktighet, säkerhetsnivå och konkurrensöverlägsenhet har inte verifierats. Konkurrentuppgifterna beskriver marknadsförda erbjudanden, inte oberoende kvalitetsbevis. Ingen webbplatskod har ändrats.
