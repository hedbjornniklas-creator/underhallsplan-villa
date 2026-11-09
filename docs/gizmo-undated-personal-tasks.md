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
Uppdatering 2026-11-09: egna manuella enkla huvuduppgifter har en penna vid
Ska vara klart. Datum kan laggas till, tidigarelaggas eller flyttas fram.
Datum kan tas bort om uppgiften saknar underuppgifter. Avslutade uppgifter,
aktiva aterkommande uppgifter och vantande forlangningsbeslut redigeras inte
har. Uppgifter till andra behaller befintligt forlangningsflode.

Slutdatum andras med versionskontroll och append-only historik med verklig
aktor och gammalt/nytt datum. Intern uppfoljning bevaras, men kortas vid behov
till den nya sluttiden; borttaget datum inaktiverar uppfoljningen. Att datum
laggs till aktiverar inte avstangda paminnelser eller ett nytt tilldelningsmejl.
Vid sparfel behalls datumutkastet. Avtal, kalkyl och projektets tidsplan berors inte.

SQL for datumredigering: `docs/db/2026-11-09_01_personal_task_due_date.sql`.

SQL: `docs/db/2026-10-30_02_undated_personal_tasks.sql`.
