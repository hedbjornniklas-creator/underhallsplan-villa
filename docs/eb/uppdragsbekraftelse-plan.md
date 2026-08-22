# EB uppdragsbekräftelse per besiktning

## Mål

Varje EB-besiktning ska i ett senare steg kunna få en egen uppdragsbekräftelse som kunden granskar och godkänner före besiktningen.

## Ägarskap av uppgifter

- Entreprenaden lagrar administrativa förval för fakturamottagare, faktura-e-post, fakturaadress och referens.
- Besiktningen lagrar uppdragets omfattning, pris, valuta och vald villkorsversion.
- När uppdragsbekräftelsen skapas kopieras aktuella förval till en versionsbunden arbetskopia för besiktningen.
- Senare ändringar i entreprenaden får inte ändra en redan skickad eller godkänd uppdragsbekräftelse.
- Fakturauppgifter och pris ska inte visas i EB-utlåtandet.

## Minsta innehåll

- Besiktningstyp, entreprenad och objekt.
- Uppdragsgivare och kontaktuppgifter.
- Besiktningsman och organisation.
- Uppdragets omfattning samt eventuella tillägg.
- Pris, valuta och information om moms.
- Fakturamottagare, org.nr/personnummer, referens, e-post och adress.
- Villkorsbilaga med nyckel, titel och versionsnummer.
- Giltighetstid samt status: utkast, skickad, godkänd, avvisad, utgången eller ersatt.
- Tidpunkter för skapande, utskick och godkännande samt spårbar mottagare.

## Flöde

1. Skapa besiktning.
2. Skapa uppdragsbekräftelse från besiktningen och entreprenadens fakturaförval.
3. Ange pris, omfattning och villkor.
4. Förhandsgranska och skicka.
5. Lås den skickade versionen.
6. Låt kunden godkänna via personlig länk och spara en oföränderlig godkännandesnapshot.
7. Vid ändring skapas en ny version; tidigare version behålls för historik.

## Fortsatt fakturering

En framtida faktura ska utgå från den godkända uppdragsbekräftelsens snapshot. Besiktningsmannen ska kunna göra en uttrycklig fakturaoverride utan att skriva om uppdragsbekräftelsen.
