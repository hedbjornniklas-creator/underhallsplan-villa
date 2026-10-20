# Projektöversikt: Nästa steg

## Beslut 2026-10-20

Användaren har valt layoutförslagets variant **Nästa steg** och godkänt att
den interna projektöversikten byggs om. Avtalet får inte påverkas.

- Översikten är en läsvy med nästa steg, datumstatus, kommande tidsplan,
  ekonomi och senast registrerade aktivitet. Den ersätter den dubblerade
  länkmenyn. Projektets registerflikar behålls.
- Formerna är mjukare än Projektarbetets tabeller: cirkeldiagram,
  rundade tidsstaplar, små statusmarkeringar och oinramade sektioner.
  Manrope, grafit, gul navigering och grönblå länkar behålls. Dämpad blå och
  korall skiljer datumstatus i diagrammet. Färg kompletteras alltid med ord.
- Projektansvarig administreras fortsatt under Översikt med samma kontroll
  och bekräftelse som tidigare. Att läsa översikten ändrar inga behörigheter.
- Projektets och Mina avser samma mängd tillgängliga punkter. Mina omfattar
  frågor tilldelade den inloggade samt projektansvarigas planeringspunkter.
  Diagrammet följer samma urval som listan, även när bara fem rader visas.
- Frågor hämtas via det befintliga deltagarfiltrerade API:t. Varken rubriker,
  aktivitet eller antal från andra frågor räknas in. En fråga som öppnas
  från översikten läses på nytt innan frågepanelen öppnas.
- Val och tillval räknas per kategori, inte per konkurrerande erbjudande.
  Ett kundval är inte en beställning eller en ändring av avtalet.
- Tidsplanen visar högst fem daterade moment som överlappar de kommande sex
  veckorna. Odaterade, ej klara moment visas som planeringspunkter.
- Avtalsbelopp och betalningsplan läses från samma godkända, publicerade eller
  låsta version när en sådan finns, annars från sparat avtalsutkast. Version
  eller utkast anges uttryckligen. Löpande räkning får ingen påhittad totalsumma.
- Kundpris i Projektarbete beräknas separat inklusive respektive momssats,
  påslag och pakettäckning. En tom Klar-bock tar inte bort ett känt belopp.
  Saknad mängd, pris eller momsunderlag får inte omtolkas till noll.
- Betalningsplan betyder fördelade avtalsbelopp, inte fakturerat eller betalt.
  Saknade priser ger Ej fastställt; avvikelse visas utan automatisk omfördelning.
- Senaste aktivitet visar metadata, inte interna meddelandetexter.
- Partiella läsfel redovisas med återförsök. Ett fel får inte presenteras som
  noll öppna frågor eller ett komplett ekonomiskt underlag.

## Avgränsning

Ingen SQL-migrering, publicering eller ändring av avtal, PDF-mall, frysta
versioner, betalningsplan eller kunddelning ingår. De befintliga redigerarna
hålls monterade vid flikbyte så att deras osparade uppgifter bevaras.
Kundens projektsida, andra moduler och global navigation ändras inte.

## Verifiering

- 617 action-cases-tester och 35 kompletterande action-case-tester passerar
  i en isolerad kopia av den publicerade basen plus endast översiktsändringen.
  Parallella PDF-ändringar och andra pågående arbeten ingår inte i kopian.
- TypeScript, riktad ESLint och `next build --webpack` passerar.
- Klickkontroll med riktiga komponenter och fiktiva uppgifter: Projektets/Mina,
  synkroniserad lista och diagram, öppna befintlig fråga efter ny åtkomstkontroll,
  tom ny fråga, tidsplanens hela klickbara rad samt läsfel och återförsök.
- 1280/1440 px dator och 320/390 px mobil kontrollerade utan sidöverflöde.
  Tidsstaplarna är 22 px medan hela momentraden har 52 px tryckyta.
- Testbackendens avtalsutkast och versioner är byte-identiska med sitt
  utgångsläge; listan över sparanrop är tom efter navigering och läskontroller.
  Frågor, kundmeddelanden, verkliga projekt och produktionsdatabas ändrades inte.
- Lokal testvy: `scripts/test-customer-offer-ui.mjs --serve --project-overview
  --independent-contract`, med enbart syntetiska HTTP-underlag. Publicering
  ingår inte i denna verifiering.
