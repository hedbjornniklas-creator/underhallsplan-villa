# Manuell klarmarkering av uppgifter

## Beslut 2026-10-30

- Den person som anges som uppdragsansvarig (issuer) kan klarmarkera en vanlig
  uppgift manuellt, utan att mottagaren forst skickar den for kontroll. Enbart
  administrator eller mottagare ger inte denna nya rattighet.
- Dialogen heter `Klarmarkera manuellt`. Kommentar kravs. Kvarstaende
  obligatoriska kontrollpunkter och saknade fardigbevis listas och maste
  uttryckligen godkannas. Oppna underuppgifter blockerar fortfarande avslut.
- Status blir godkand, men bade uppgiftsvyn och den oforanderliga historiken
  anger att avslutet registrerades manuellt av uppdragsansvarig. Ingen handling
  tillskrivs mottagaren och inget fardigbevis eller verifierat kontrollbeslut
  skapas artificiellt. Befintliga kontrollpunkter och bilagor bevaras.
- Ingen inlamningstid hittas pa. Saknas mottagarens inlamningstid blir
  leveranspunktlighet okand i befintlig statistik, inte automatiskt forsenad.
- Obehandlade forlangningar avslutas utan datumandring. Befintliga regler for
  notifieringar och aterkommande uppgifter fortsatter att galla.
- Systemskapade uppgifter, exempelvis uppladdning av signerat avtal, avslutas
  fortfarande via sin ursprungsfunktion. Avtal, projektkalkyl och projektfragor
  andras aldrig genom denna uppgiftsatgard.

## Databasskydd

`docs/db/2026-10-30_01_task_manual_completion.sql` kravs fore apppublicering.
Den installerar ett service-only RPC med org-/aktorskontroll, radlasning,
versionskontroll och exakt bekraftelse av de aktuella saknade kraven. Avslut,
avskrivna datumforfragningar och historik sparas atomart. Upprepning av samma
begaran efter forlorat sparsvar ger inga dubbla handelser eller aterkomster.
Eventuellt forsta utskick till nasta externa aterkomst frigors i den befintliga
bestandiga arbetskon i samma transaktion. Personlig lank skapas av arbetskon,
inte genom ett extra direktutskick efter att avslutet har sparats.

Migreringen skriver inte om befintliga uppgifter eller avtal. Gotlandsgatans
riktiga uppgift far inte anvandas for mutationstester. SQL och publicering ar
separata steg efter lokal verifiering.

## Verifiering

- 22 riktade tester passerar, inklusive verkliga tabellvillkor, org-/rollskydd,
  versionskonflikter, exakta kvarstaende krav, atomisk aterstallning vid fel,
  oforandrad inlamningstid och den verkliga aterkomsttriggern/utskickskon.
- Den breda Uppdragssviten passerade med 716 tester. Riktade tester och
  klicktester korde aven efter den sista rattingen av aterkomstens utskick.
- Desktop samt mobilbredder 390 och 320 px ar kontrollerade. Kommentar bevaras
  vid sparfel och uppdaterat underlag; nya krav kraver ny bekraftelse aven utan
  versionsbyte. Tab stannar i dialogen och Escape lamnar uppgiften oppen.
- Avgransad ESLint och produktionsbygget passerar i en isolerad kopia utan
  parallellt PDF-/dokumentarbete. Inga riktiga uppgifter eller avtal andrades,
  inga mejl skickades och ingen SQL eller app publicerades under verifieringen.
