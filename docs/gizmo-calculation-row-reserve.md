# Kalkylrad och kalkylreserv

Beslut 2026-11-27, endast kalkylen i Projektarbete:

- Pennan och rubriken Redigera kalkylrad öppnar/fäller ihop samma rad.
- Sparstatus och bekräftad borttagning ligger vid rubriken.
- Leverantörsofferter är en separat utfällning som inte ersätter radens övriga fält.
- Procentpåslaget benämns Entreprenörsarvode. Lagringsfältet markupPercent behålls.
- Kalkylreserv kan anges på alla redigerbara kostnadsslag. Standard är 0 %.
- Kalkylens kundpris exklusive moms = mängd × enhetskostnad × (1 + reserv/100) × (1 + arvode/100).
- Intern grundkostnad förblir mängd × enhetskostnad. Reserv och arvode är inte moms.
- Saknad mängd/kostnad är fortsatt okänd; noll kronor är ett känt pris.
- Sparade kundprisvillkor ändras endast genom befintligt uttryckligt val att använda kalkylens belopp.
- Låsta avtal och skyddade offert-/paketkopplingar behåller befintliga spärrar.

## Installation

Kör `docs/db/2026-11-27_01_calculation_reserve.sql` före applikationspublicering.
Migreringen lägger till ett reservfält och en ny RPC som återanvänder den
befintliga versionsstyrda skrivfunktionen. Den uppdaterar inga befintliga
belopp, tidsstämplar, kundpriser eller avtalsdokument vid installation.
Uppdateringar som saknar reservfält bevarar en redan sparad reserv; uttryckligt
0 återställer den. Återförsök använder samma begäran och slutliga versionskvitto.

## Verifiering

- `test/action-cases-item-sheet.test.mjs`: utfällningar, bekräftelser, sparfel och låsning.
- `test/action-cases-calculation-reserve.test.mjs`: ordningsföljd, alla kategorier, noll/saknat pris och isolerat SQL-prov.
- `test/action-cases-calculation-autosave.test.mjs`: reserv i ordinarie spar-/återförsöksflöde.
- `scripts/test-calculation-row-ui.mjs`: riktiga komponenter och sparningskö med fiktiv lokal transport, dator och två mobilbredder.
- `test/tsconfig-calculation-row.json`: avgränsad typkontroll inklusive testvyn.

Efter klicktestet kan den fiktiva förhandsvisningen startas med
`node --experimental-strip-types scripts/test-calculation-row-ui.mjs --preview`.
Den använder bara loopback och testuppgifter, inte Hushubs databas eller mejl.
