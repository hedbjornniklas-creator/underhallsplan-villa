# Namnbyte till Gizmo

Beslut 2026-11-09: slutför omprofileringen av Uppdrag till Gizmo och publicera
när ändringen är testad. Detta är ett namnbyte, inte ett nytt projektflöde.

## Omfattning

- Modulväljare och dashboard visar Gizmo, med visningsförkortningen GZ.
- Interna webbläsarflikar, laddning och åtkomståterställning visar Gizmo.
- Mottagarvyer använder Gizmo med befintlig symbol och lokalt Manrope.
  Den gamla logotypfilen skrivs inte om eftersom utskrifter använder den.
- Modulhänvisningar i frågor, offertförfrågningar och felmeddelanden använder Gizmo.
- Nya uppgiftsmejl och samlingsmejl har Gizmo som huvudnamn, från HusHub.
- Administrationens lästa katalog och befintliga behörighetsposter visar Gizmo
  och Gizmo-användare för de oförändrade nycklarna tasks och task_member.
  Databaskatalogen och historiska tilldelningar skrivs inte om.

## Oförändrat

Alla URL:er under /uppdrag, /mina-uppdrag, /signe, /fraga, /dagbok,
/atgardsarende och /offertunderlag, inklusive frågeparametrar och personliga
länkar, behålls. API-rutter, databasnycklar, rollnycklar, CSS-namn och filnamn
behålls också. Ingen omdirigering, SQL eller datamigrering behövs.

Ord som uppdrag, uppgift, uppdragsansvarig och Mina uppdrag beskriver arbetet
och behöver inte ersättas med produktnamnet. Avtalens rubrik Uppdraget,
standardtexter, PDF-mallar, frysta dokument och befintliga mejlloggar lämnas orörda.
Inga ändringar av avtal, pris, kalkyl eller projektdata görs.

Datumredigering för egna uppgifter är ett separat, ännu opublicerat arbete
som kräver sin egen SQL-funktion och inte ingår i denna publicering.

## Verifiering

`node --test test/gizmo-rebranding.test.mjs` kontrollerar visningsnamn,
tekniska nycklar, varumärkesrad, nya mejl och oförändrade mål för länkar.
`node scripts/preview-gizmo-branding.mjs --test` testar den verkliga
modulväljaren och mottagarprofilen på dator och mobil med fiktiva uppgifter.
Varken projektdata eller mejlutskick används i dessa tester.
