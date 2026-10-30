# Egna uppgifter utan datum

Beslut 2026-10-30: egna uppgifter ska kunna skapas utan slutdatum och
uppfoljningsdatum. Det gor att befintliga att-gora-uppgifter kan overforas
utan pahittade deadlines. Datumkraven for tilldelning till andra andras inte.

## Implementerat

- `Utan datum` kan valjas for en manuell, fristaende `Enkel uppgift` med
  den inloggade anvandaren som mottagare och uppdragsansvarig.
- Bada tidpunkterna lagras som SQL NULL. Delvis ifyllda scheman tillats inte.
- Uppgiften syns i Aktuellt, sorteras efter daterade uppgifter vid
  datumsortering och markeras inte som forsenad enbart for att datum saknas.
- Skapandet har en egen atomisk, service-only RPC med medlemskontroll och
  verklig aktor i historiken. Ingen tilldelning till andra ar mojlig via den.
- Ingen automatisk paminnelse, e-post eller WhatsApp schemalaggs.
- Starta, manuell klarmarkering, avbryt och radera behaller sina vanliga
  behorighetskontroller. Vantelage, granskningsflode, aterkommande uppgifter
  och underuppgifter forutsatter fortfarande ett daterat uppdrag.
- Avtal, projektarbete och betalningsplaner berors inte.

## Avgransning

Detta ar inte en automatisk To Do-synk. Originaluppgifter ska inte andras,
och varje separat overforing maste kontrolleras mot befintliga uppgifter.
Senare schemalaggning av en redan odaterad uppgift ar en separat funktion.

SQL: `docs/db/2026-10-30_02_undated_personal_tasks.sql`.
