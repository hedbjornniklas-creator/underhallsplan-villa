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

## Aktivering

Kör `docs/db/2026-10-19_03_project_question_customers.sql` efter den befintliga
frågemigreringen `2026-10-19_01_project_questions.sql` före publicering av den nya
mottagarfunktionen. Ingen historisk dataöverföring eller massändring ingår.
Om den nya SQL-funktionen saknas fungerar den tidigare kontaktlistan fortsatt;
redigeraren anger då att beställarlistan behöver aktiveras.

## Beslutslogg

- 2026-10-19: Användaren godkände direkt återanvändning av beställare utan extra
  bock. Utskick och ÄTA-godkännande hålls separata. Databaskopplingen godkändes
  uttryckligen; avtalsuppgifter ska inte ändras.
