# Frågor: beställare och snabbregistrering

## Beslut 2026-10-19

- Frågor och beslut flyttas efter Tidsplan i projektets registerflikar.
- Beställare återanvänds direkt som valbara ansvariga, utan extra aktiveringsbock.
- Valbarhet, tilldelning och svar är inte en rätt att godkänna ÄTA eller avtal.
- Frågan delas först genom det separata, granskade kommandot Skicka till ansvarig.
- Spara och skapa nästa sparar frågan och öppnar därefter ett tomt formulär.
- Översikten visar både Skapad och Uppdaterad. Mötesdatum är en separat uppgift.

## Genomförande

Beställarlistan läser projektets beställarkontakter och namn/kontaktuppgifter i
det egna avtalsutkastet. Projektets huvudsakliga beställare används som reserv
om dessa saknas. Namn och e-post normaliseras för dubblettkontroll, men två olika
namn med samma e-postadress förblir två val. Personnummer lämnas aldrig till
frågeredigeraren. En gammal fråga som använt en vanlig kontakt kan fortsatt
redigeras utan att ansvarig byts i bakgrunden.

Läsning och tilldelning skapar varken kontaktkonto, projektåtkomst, inbjudan eller
utskick. Frågan får en historisk kopia av ansvarigs namn och e-post. Vid uttryckligt
utskick kontrolleras uppgifterna igen. Då återanvänds en matchande aktiv kontakt
i Uppdrag, eller skapas en mottagarkontakt i samma transaktion som uppgiften och
utskickskön. Avstängda kontakter aktiveras inte automatiskt. Ett misslyckat utskick
rullar tillbaka även en ny kontakt. Äldre historik skrivs inte om.

Skapad-tiden hämtas från frågans första, oföränderliga registreringspost. Den
ersätts inte med mötesdatum eller senaste uppdatering om historik skulle saknas.

Spara och skapa nästa behåller texten och samma återförsöksidentitet vid sparfel.
Efter bekräftad sparning får nästa fråga ett nytt id och tomma fält, utan ärvd
ansvarig eller bilagor. Ett fel vid efterföljande omläsning skapar inte om frågan.

Avtal, låsta avtalsversioner, PDF, offert, Val och tillval och betalningsplaner
skrivs inte av denna funktion. En fråga eller ett svar blir inte automatiskt ÄTA.

## Utskicksvyer 2026-11-05

Frågans registerflikar är Fråga, Kommunikation, Deltagare och Historik och
återanvänder projektets registerflikstil och tangentbordsnavigation. Hela raden
i frågelistan öppnar frågan; frågeknappen finns kvar för tangentbord.

Ansvarig och den hopfällbara delen Skicka till ansvarig ligger under Fråga.
En redan aktiv individuell uppgift visas med status och länk i stället för en
spärrad, oförklarad flik. Dubblettutskick är fortsatt spärrade.

Under Deltagare visas Dela med deltagarna i samma fasta nederkant som Stäng.
Bilageurval och uttrycklig granskningsbekräftelse ligger kvar i innehållet.
Frågeuppgifter och deltagarval autosparas med versionskontroll. Sparfel
behåller önskat läge och exakt återförsöksidentitet. En äldre flik skriver inte
tyst över en nyare version. Utkast skyddas lokalt per användare och projekt.

Påbörjade meddelanden, interna anteckningar och utskicksuppgifter sparas bara
som lokala utkast tills användaren väljer att skicka eller publicera. Granskad
delning, utskick och avslut sker aldrig genom autosparning. Lokala utkast är
inte serverhistorik och följer inte automatiskt med till en annan enhet.

Kommunikation visar delade meddelanden och interna anteckningar i tidsordning.
Två uttryckliga skrivlägen hålls isär, med separata utkast. Tidigare interna
anteckningar och svar från individuella uppgifter får inte publiceras som en
bieffekt av sammanslagningen. De visas bara internt med tydlig märkning.

Ny extern kontakt använder Uppdrags befintliga kontaktregister, kontaktfält och
skapandefunktion. Bara projektansvarig kan lägga till deltagaren. Ett kvitterat
kontakt-id återanvänds vid nätverksåterförsök; själva skapandet delar inte frågan
eller skickar mejl. En ny kontakt läggs till med ett uttryckligt kommando, inte
genom att ofullständiga namn- och e-postfält autosparas som personer.

Att spara deltagare skickar ingen e-post. Dela med deltagarna köar personliga
mejl till övriga aktiva, delade deltagare med e-postadress. Nya svar köar samma
typ av notifiering; avsändaren notifieras inte om sitt eget meddelande.
Extern mottagare får en personlig frågelänk och intern medarbetare en länk till
projektets frågor. Interna anteckningar delas inte. Dessa regler ändras inte av
knapparnas placering.

Mottagarsidans inledande text är Bekräfta att du har tagit emot uppdraget och
knappen heter Bekräfta mottaget. Användaren valde uttryckligen enbart textbyte;
befintlig övergång till Pågår och uppföljningslogik ändras inte. Det framgår
även i mottagarens förklaring.

## Testuppföljning 2026-11-05, etapp 1

Arbetskopian kompletteras efter de manuella testerna F-002 och F-003. Denna
etapp ändrar inte mottagarnas befintliga länkar eller separata dialogflöden.
Att samla själva kommunikationen är nästa etapp, inte en bieffekt av denna.

- En öppen fråga hämtar uppgiftssvar och status i bakgrunden var tjugonde sekund
  och när fönstret åter får fokus. Kommunikationens hämtningsknapp läser också
  de kopplade uppgifterna. Påbörjad frågetext och meddelandeutkast ersätts inte.
- Äldre lässvar ignoreras om en senare hämtning redan har startat. Läsfel visas
  separat, utan att ett tidigare skrivfel tyst försvinner vid nästa hämtning.
- Ny fråga har även kommandot Skapa fråga. Spara och skapa nästa finns kvar.
  Befintlig autosparning behålls; skapa och återförsök använder samma kö och id.
- Utskick visar vilka uppgifter som saknas: ansvarig, mottagarens e-post när den
  behövs, svarsdatum och granskningsbekräftelse. En vald uppföljning efter
  svarsdatumet spärrar också utskick. Under pågående anrop visas inte Försök igen.
- Historik visar oföränderliga sparade deltagarurval och delningar i tidsordning
  tillsammans med frågans tidigare historik. Skillnader visas mellan två sparade
  urval. Första urvalet får ingen påhittad före-bild. Det är urvalsändringar, inte
  ett rekonstruerat register över all automatisk behörighetsstyrning.
- Äldre urval innehåller personreferenser, inte frysta namn. Därför markeras att
  namn hämtas från frågans kontaktuppgifter. Delningar visar däremot sitt sparade
  underlag, filnamn och mottagarnamn från de registrerade utskicken.
- Utskick märks köat, skickas, överlämnat till e-posttjänsten, misslyckat eller
  återkallat. Överlämnat är inte ett påstående om leverans eller läsning.

Ingen SQL-migrering behövs: endast befintlig lagring läses. Historik och
mottagaruppgifter lämnas enbart till interna, aktiva deltagare i respektive
fråga. Avtal, offert, kalkyl och betalningsplaner skrivs inte av ändringen.

## Gemensam kommunikationsvy, etapp 2

Kommunikationsvyn låter den individuella uppgiftens parter skriva direkt under
Kommunikation. Den befintliga personliga länken och mottagarens sida behålls.
Ingen äldre text kopieras till gruppdialogen. Samma tidslinje visar båda
källorna, med märkning av enskild dialog, delat meddelande och intern anteckning.

Om frågan enbart skickats individuellt är den enskilda mottagaren förvald.
En delad gruppfråga behåller gruppen som standard. Om både en äldre individuell
uppgift och en grupp finns kan användaren uttryckligen välja den enskilda
uppgiften. Varje skrivläge har ett separat lokalt utkast. Ett oskickat utkast
får inte byta mottagare tyst, och återförsök behåller exakt begäran och mottagare.
En uttrycklig mottagarkonflikt från databasen betyder att försöket inte har
sparats. Då släpps den avvisade begäran, texten behålls och aktuell mottagare
måste bekräftas före ett nytt försök. Vid osäkert nätverksfel behålls däremot
den ursprungliga begäran för ett exakt, dubblettsäkert återförsök.

Den individuella svarsfunktionen kräver
`docs/db/2026-11-05_03_project_question_task_replies.sql` före publicering.
Funktionen låser den kopplade frågan och uppgiften, kontrollerar aktivt
deltagarskap och uppgiftens ordinarie parter samt mottagarens id och e-post.
Meddelande och Uppdrags befintliga notifieringskö sparas i samma transaktion.
Samma begärande-id skapar inte flera meddelanden. En återkallad eller ändrad
mottagare kan inte nås genom ett gammalt, ännu oskickat utkast.

Gruppdialogens filbilagor och interna anteckningar fungerar fortsatt. Svar i den
enskilda uppgiften från frågevyn är textmeddelanden; uppgiftens övriga underlag
ligger kvar på dess befintliga sida. Svar avslutar inte frågan. Projektansvarig
behåller ensam deltagarhantering, och statusflödet för Uppdrag ändras inte.

Individuella frågeuppgifter hämtar projektnamnet som mejlkontext i stället för
den generiska etiketten Projektfråga när meddelandet byggs. Uppgiftens lagrade
version, status och uppföljningsdatum ändras inte för detta. Gruppaviseringar visar projektnamn och
frågenummer. Den nya SQL-filen ändrar inga befintliga meddelanden eller avtal.

## Valfri extra uppföljning, 2026-11-12

Första uppföljning är frivillig när en fråga skickas till ansvarig. Svar senast
och granskningsbekräftelsen krävs fortsatt. Ett angivet uppföljningsdatum måste
vara giltigt och inte senare än svarstiden. Ett tomt datum ignorerar klockslaget.

Frågans servernormalisering använder svarstiden som intern kontrollpunkt när
ingen extra avstämning valts. Den befintliga uppgiftsmotorn och dess
datumkrav lämnas oförändrade. Påminnelser för nära/försenad deadline prioriteras
före statuskontrollen, så ingen extra tidig statuspåminnelse införs. Befintliga
uppgifter, påminnelseinställningar och avtal skrivs inte om. Ingen SQL behövs.

Vid datumen visas ett diskret standardschema från den befintliga
påminnelsepolicyn: 3 och 1 arbetsdag före, samt på svarsdagen. Utfällbar
komplettering förklarar fortsatta påminnelser, pauser och utskickstider.

## Aktivering

### Ansvarigbyte och direktbilagor, 2026-11-12

Projektansvarig kan välja **Byt ansvarig** i en redan skickad, aktiv fråga.
Bytet kräver granskning och sparas atomiskt med versionskontroll för både fråga
och uppgift. Samma uppgift, status, svarstid och historik behålls. Den tidigare
personliga uppgiftslänken spärras och dess påminnelser stoppas. **Skicka till ny
ansvarig** är ett separat steg; själva bytet skickar inget. Ett osäkert utskick
eller en öppen begäran om ändrad svarstid måste hanteras före byte.

Gruppdeltagande är separat. Tidigare ansvarig tas inte bort från en befintlig
gruppdialog. Ny ansvarig läggs till som odelad deltagare. Beställare återanvänder
kontaktbryggan när en aktiv uppgift faktiskt byter ansvarig, utan att avtal eller
delning ändras. Vanliga Att göra kan inte kringgå frågans ansvarigstyrning.

**Lägg till bild eller dokument** sparar vid behov den nya frågan före uppladdning.
Filen kopplas privat direkt till frågan (högst 25 MB per fil), väljs via sitt
bekräftade fil-ID och delas inte automatiskt. Det krävs inget projektfilsteg.
Högst 20 bilagor kan väljas per meddelande eller utskick.

Mottagarsidorna använder gemensam Gizmo-profil. Bekräfta mottaget finns direkt
vid Ditt nästa steg, utan krav på meddelande. Övriga åtgärder finns under Mer.
När uppgiften pågår finns Klar för kontroll i fast sidfot. Tid och uppföljning
samt tomma underuppgifter är infällda.
Medskickade filer visas före kommunikationen i **Bilagor till uppdraget**,
en utfällbar sektion med antal som är öppen från början när bilagor finns.
Mottagarens uppladdningar visas separat under **Ditt underlag**, efter
kommunikationen. Uppdelningen bygger på uppladdarens identitet, inte på om
filen är ett färdigbevis. Samma vy används för enskilt tilldelade frågor och
Att göra, via personlig länk och Mina uppdrag. Bilder använder den befintliga
bildvisaren och samma skyddade filadress som tidigare. Tid och uppföljning
ligger efter Ditt underlag. Pågående tidsbegäran och obligatoriska kontrollpunkter
behåller sina varningar och spärrar. Ingen SQL-ändring behövs för layouten.
Gruppfrågan visar svarsfältet före meddelanden, de tre senaste meddelandena
och äldre meddelanden i en infälld kronologisk del. Interna anteckningar
delas aldrig. Befintliga länkar, statusflöden och mejlkanaler ändras inte.

Kör `docs/db/2026-11-12_01_project_question_reassignment.sql` efter
`2026-11-10_01_task_details_editing.sql` före publicering av ansvarigbytet.
Migreringen ändrar funktioner, inte befintliga projektuppgifter. Den kördes i
produktion 2026-11-12 efter användarens godkännande. Driftens CRLF-radbrytningar
normaliseras före den fortsatt exakta kontrollen av befintlig behörighetskod.
En jämförelse av 13 tabeller i Lokevägen och Gåshaga visar oförändrade uppgifter.
Avtal och kalkyler ingår inte i ändringen.

### Internt färdigdatum, 2026-11-12

Projektansvarig kan välja **Ändra färdigdatum** bredvid den aktiva uppgiftens
datum i Fråga. Datum och klockslag visas i Stockholmstid. **Spara färdigdatum**
ändrar samma uppgift; mottagare, status, bilagor och personlig länk behålls.
Gammalt och nytt datum, vem som ändrade och tidpunkten sparas i historiken.
Ingen ny tilldelning skickas och mottagarens Begär mer tid är oförändrad.

Den gemensamma uppgiftsmotorn flyttar påminnelserna. Ett tidigare separat
uppföljningstillfälle behålls om det ryms före det nya färdigdatumet; ett
datumstyrt eller för sent tillfälle följer det nya datumet. Öppna beslut om
ändrad svarstid, osäker leverans, återkommande schema och konflikter med
underuppgifters datum måste hanteras först. Versionskontroll gäller både fråga
och uppgift. Nätfel behåller exakt samma återförsök; en konflikt kräver ny granskning.

Kräver `docs/db/2026-11-12_02_project_question_due_date.sql` efter migreringen
för ansvarigbyte. Installationen ändrar inga befintliga rader. Vanliga manuella
Att göra använder fortsatt Slutdatum i Redigera uppgift. SQL-uppdateringen kördes
i produktion 2026-11-12 efter användarens uttryckliga godkännande. Publicering
och driftkontroll dokumenteras i releaseprotokollet.

Kör `docs/db/2026-10-19_03_project_question_customers.sql` efter den befintliga
frågemigreringen `2026-10-19_01_project_questions.sql` före publicering av den nya
mottagarfunktionen. Ingen historisk dataöverföring eller massändring ingår.
Om den nya SQL-funktionen saknas fungerar den tidigare kontaktlistan fortsatt;
redigeraren anger då att beställarlistan behöver aktiveras.

## Beslutslogg

- 2026-10-19: Användaren godkände direkt återanvändning av beställare utan extra
  bock. Utskick och ÄTA-godkännande hålls separata. Databaskopplingen godkändes
  uttryckligen; avtalsuppgifter ska inte ändras.
- 2026-11-05: Användaren godkände förbättringsplanen efter manuella tester av
  individuell uppgift och gruppdialog: aktuell status, tydligare sparning och
  utskick, synlig deltagarhistorik samt svar direkt i Kommunikation. Äldre
  interna och individuella meddelanden får inte bli gruppmeddelanden i efterhand.
- 2026-11-12: Användaren gör första uppföljning frivillig, behåller ordinarie
  påminnelser och vill se ett diskret schema vid utskicket. Publicering av detta
  och dagbokens bildval är uttryckligen godkänd.
- 2026-11-12: Användaren godkänner ansvarigbyte direkt i projektfrågan med
  bevarad historik och separat utskick, direktbilagor och förenklade
  mottagarsidor enligt Gizmo-profilen. Ingen publicering ingår i godkännandet.
- 2026-11-12: Användaren godkänner därefter SQL-körning och publicering av paketet.
- 2026-11-12: Efter test av F-013 vill användaren ha bekräftelseknappen direkt
  i Nästa steg i stället för genvägen Skriv ett meddelande. Statusflödet behålls.
  Ett nytt separat testutskick med fiktiva dokument och bilder till jn@hedbjorn.se
  är godkänt; denna nya knappändring är ännu inte publicerad.
- 2026-11-12: Användaren godkänner det nya mottagarupplägget för frågor och
  Att göra, inklusive bekräftelseknappen i Nästa steg, och publicering efter
  verifierade tester. Befintliga länkar, åtkomsträttigheter och statusflöden
  ska behållas. Befintliga uppgifter, avtal och kalkyler ändras inte.
- 2026-11-12: Användaren vill kunna ändra färdigdatum internt på samma sätt som
  ansvarig. Mottagaren får inte någon ny rätt att själv ändra datumet. Funktionen
  byggs i den ägande projektfrågan, med bevarad historik och ordinarie påminnelser.
- 2026-11-12: Användaren godkänner SQL-körning och publicering av datumändringen
  tillsammans med hovrings- och fokusmarkeringen i mottagarens Mer-meny.
