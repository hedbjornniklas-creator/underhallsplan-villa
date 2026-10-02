# Statusbesiktning i ÖB-modulen

## Beslut 2026-10-02

Statusbesiktning är ett fjärde val bredvid Säljare, Köpare och Lägenhet i
befintlig ÖB-modul. Samma uppdrags-, boknings-, besiktnings- och leveransflöde
återanvänds. Ingen ny modul eller separat rumsrunda införs. Det befintliga
undantaget för tidig start av ÖB gäller inte automatiskt statusbesiktning.

- Dataklassificering: `assignment_type = STATUS`, `inspection_family = OB`,
  `inspection_variant = SB`, visningsprofil `status`.
- SBR:s fasta texter ska återges ordagrant från de verifierade originalen.
  Uppdragets variabler fylls i separat och den skickade texten fryses.
- Omfattning ska anges uttryckligen, även vid delbesiktning. Avbokningsavgiften
  ska anges före utskick; ett avsiktligt angivet nollbelopp är tillåtet.
- Rum, byggnadsdelar, bilder och noteringar återanvänds. Rekommendationer och
  övriga kommentarer är frivilliga manuella uppgifter för statusbesiktning.
  Befintliga ÖB-risker/FTU-texter omvandlas aldrig automatiskt.
- Byte mellan ÖB och statusbesiktning får inte ändra en redan skickad eller
  godkänd kopplad uppdragsbekräftelse. Då behövs en ny bekräftelse. Byte i ett
  utkast kräver bekräftelse när det finns texter som döljs i den nya profilen.
  Ett tomt utkast kan byta utan varning. Tidigare texter behålls utan omtolkning.
- Statusbesiktningens uppdragstyp skiljs från objekttypen: **Fastighet** eller
  **Lägenhet**. Omfattningen anges separat, exempelvis badrum i lägenhet.
  STATUS/SB, de fasta SBR-texterna och villkoren ändras inte av objektvalet.
  För STB-lägenhet anges lägenhetsnummer. Förening och lägenhetsinnehavare är
  frivilliga, så även hyreslägenheter fungerar utan påhittade BRF-uppgifter.
  Fastighetsägare och fastighetsbeteckning krävs inte för STB-lägenhet.
- Kataloggranskning är en separat senare uppgift. Befintliga strukturella
  inställningar och dokumenttyper för köpare eller säljare återanvänds uttryckligen
  för STB. Lägenhetsspecifika inställningar görs inte generellt tillämpliga.
  Inga katalogposter eller deras `applies_to`-värden massändras.

## Implementationsgränser

`src/lib/ob/inspectionProfile.ts` är gemensam tolkning av klassificeringen.
`STATUS` eller ÖB-varianten `SB` får aldrig bli köparprofil genom ett reservval.
Okända värden behålls som okända; äldre uttryckliga reservval kan användas av
anroparen för äldre ÖB-data.

`src/lib/ob/objectType.ts` tolkar objekttyp separat. Uppdrag sparar
`assignment_details.objectType` (`property`/`apartment`) och direkta besiktningar
sparar `ob_property_snapshot.object_type`. Befintliga fria fält för bostads- och
fastighetstyp skrivs inte över. Vanlig köpar-, säljar- och lägenhetsbesiktning
behåller sina tidigare objektregler. Noteringskatalogen ändras inte av detta.

Vid STB-utskick fryses även objekttypen som `statusObjectType`. Kundens
godkännandesida och validering följer det frysta valet. Accepterad objekttyp och
lägenhetsuppgifter förs vidare till besiktningen och rapportens egen snapshot.
Byte av objekttyp efter en skickad/godkänd kopplad bekräftelse kräver en ny UB;
det är inte ett sätt att ändra omfattningen i ett redan ingånget uppdrag.
Äldre skickade STB-länkar och rapporter utan objektmarkör behåller sitt tidigare
fastighetsbeteende. De omklassificeras inte från fritext eller senare metadata.

Uppdragets överenskomna omfattning skiljs från valda tilläggsuppdrag i STB-vyn.
Val av tillägg får inte skriva över fritexten för omfattning. Nya STB-upplysningar
startar tomma, utan automatiska påståenden om säljare eller frånvaro av kända fel.

Äldre besiktningar, noteringar, publicerade rapporter och accepterade avtal ska
inte skrivas om historiskt. Databasmigrationer och driftsättning måste verifieras
separat; att kod och tester finns lokalt innebär inte att funktionerna är i drift.

## SBR-original och driftsättning

Fasta texter hämtas från följande verifierade DOCX-original. JSON-källorna under
`src/content/standardtexts/status/` behåller originalens stavning, blanksteg och
interpunktion; standardiserande textrensning får inte användas för dessa texter.

- Uppdragsbekräftelse: **STB Uppdragsbekräftelse ink villkorsbilaga 2026.1.docx**.
- Utlåtande: **STB Utlåtande ink villkorsbilaga 2026.2.docx**.

Båda originalens villkorsbilagor anger 2026.1 men innehåller olika formuleringar.
De bevaras därför separat, inte som en sammanslagen eller omskriven bilaga.
Uppdragsbekräftelsens omfattning, pris, avbokningsavgift och dokumentkälla fryses
vid utskick; godkännandet och den arkiverade PDF-kopian använder denna källa.
Fastställda utlåtanden fryser också den tillhörande rapportbilagan.

För accepterade STB-uppdrag hämtar utlåtandet den överenskomna omfattningen och
godkännandedatumet från den verifierade, arkiverade uppdragsbekräftelsen, inte
från senare ändrade uppdragsfält. Om detta arkiv saknas kan ett ofullständigt
eller omtolkat utlåtande inte skapas. Vanliga ÖB-uppdrag ändras inte av detta.

En direkt skapad STB-besiktning behöver bekräftade villkor och överenskommen
omfattning, digitalt eller genom en separat uppdragsbekräftelse, innan uppdraget
genomförs. Appens rapport är inte ett bevis på kundens godkännande. Om någon
digital bekräftelse inte är känd behåller rapporten besiktningens omfattning och
utelämnar originalmeningarna som påstår att bekräftelsen överlämnats och gåtts
igenom. Övriga SBR-originaltexter och villkor behålls utan omskrivning. Detta
inför ingen ny generell publiceringsspärr för direkt skapade besiktningar.

Applicera migrationerna i ordning före driftsättning:

1. `docs/db/2026-10-02_01_ob_status_assignment.sql` – STB-uppdrag och dokumentkälla.
2. `docs/db/2026-10-02_02_ob_status_note_fields.sql` – manuella noteringsfält och
   atomiskt skapande av bildnoteringar.
3. `docs/db/2026-10-02_03_ob_status_building_notes.sql` – motsvarande noteringsstöd
   för besiktningar med byggnadsindelning.
4. `docs/db/2026-10-02_04_ob_status_object_type.sql` – separat objekttyp,
   fryst objektval och överföring av accepterade lägenhetsuppgifter.

Om 1–3 redan har applicerats räcker det att köra 4 före denna driftsättning.

Migrationerna förutsätter de befintliga ÖB-migrationerna som anges i respektive
SQL-fil. De är omkörningsbara och har testats i isolerad PostgreSQL/PGlite utan
att skriva om historiska noteringar, accepterade dokument eller kvittenser.
Ingen produktionsdatabas ändrades som del av denna lokala implementation.

Verifiera efter driftsättning ett nytt STB-uppdrag hela vägen från utskick och
godkännande till en avgränsad besiktning, fastställt digitalt utlåtande och PDF.
Kontrollera även ett befintligt ÖB-uppdrag innan funktionen används skarpt.

## Beslutslogg

| Datum | Beslut | Grund |
| --- | --- | --- |
| 2026-10-02 | Fjärde val i samma ÖB-flöde; SBR-original; frivilliga manuella rekommendationer/kommentarer; senare kataloggranskning. | Uttryckligt produktbeslut och godkänd implementation. |
| 2026-10-02 | Uttrycklig omfattning och avbokningsavgift; ingen tyst konvertering av äldre texter eller redan skickade avtal. | SBR-originalens variabler och förtydligade skydd vid typbyte. |
| 2026-10-02 | Separat objekttyp Fastighet/Lägenhet för statusbesiktning; lägenhetsnummer följer UB, godkännande, besiktning och rapport. Fasta STB-texter behålls. | Användarens godkända exempel: statusbesiktning av badrum i lägenhet. |
