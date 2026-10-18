# ÖB: läsbehörighet till kollegornas uppdrag

SQL-filerna är förberedda för operatörens granskning. Att filerna finns i Git innebär inte att de har körts i produktion.

## Användning och avgränsning

I **Inställningar → Organisation → Medlemmar** kan organisationsadministratören bocka i **Se kollegornas ÖB-uppdrag** för en medlem och välja **Spara läsbehörighet**. Valet är separat från roll och arbetsområden, och gäller bara den aktuella organisationen. Befintliga och nya medlemmar börjar avstängda enligt produktbeslutet den 12 oktober 2026.

Påslaget ger läsning av kollegornas ÖB/STATUS-uppdrag, uppdragsbekräftelser och utlåtanden. Kollegans uppdrag markeras **Endast läsning**; besiktningslänken öppnar utlåtandet, inte arbetseditorn. Sparade PDF:er och frysta digitala rapporter behåller sitt befintliga innehåll. Kollegornas uppdrag räknas inte som egna arbetsuppgifter i den personliga översikten. Avstängt innebär egna uppdrag. Att ge läsrätt överlåter inte ansvar och tillåter inte ändring, start, arkivering, upplåsning, låsning eller utskick av kollegans uppdrag.

Kundregistret är fortsatt gemensamt. TU och EB behåller sin tidigare behörighetsmodell. Överlämning av uppdrag och ett bredare system med separata skrivrättigheter ingår inte i detta steg.

## Införande

Kör den skrivskyddade preflight-filen, granska varje avvikelse och ta ordinarie säkerhetskopia. Kör sedan migrationen före den tillhörande appversionen och följ upp med postflight. Den paginerade översikten kontrolleras mot hela den tidigare funktionskroppens hash; en okänd databasversion stoppar transaktionen. Äldre klienter omfattas också av de nya ägarreglerna för ÖB.

Ingen medlem får flaggan automatiskt. Saknad rad betyder `false`, revision `0`. Administratörens service-endpoint använder `organization_member_ob_visibility_set(p_actor,p_org,p_profile,p_can_view,p_revision)` med identitet från serversessionen. Den returnerar `saved`, `canViewColleagues` och `revision`; gammal revision ger `ORG_CONFLICT`. Tabellen kan läsas av serviceklienten men ändras bara via den privata databasfunktionen. `updated_by` och `updated_at` visar senaste ändringen; detta är ingen fullständig historisk händelselogg.

`organization_member_ob_visibility_list(p_actor,p_org)` kräver samma aktiva organisationsadministratör och returnerar högst 1 000 medlemmars `profileId`, `canEnable`, `canViewColleagues` och `revision`. En större medlemslista ger ett uttryckligt fel. `canEnable` använder faktisk modulåtkomst, även för godtagna äldre globala tilldelningar som inte ingår i medlemssidans redigerbara modulval.

Flaggan kräver aktivt medlemskap och en faktisk aktiv ÖB-tilldelning för läsning av kollegor. Hanterade organisationer kräver organisationens egen `dashboard/inspections/inspector`-tilldelning. Ett globalt inspektörsgrant gäller endast i en ännu ohanterad organisation. Befintlig åtkomst till egna uppdrag behåller SQL05:s legacyregler.

Läsning begränsas till samma organisation. Ändring kräver `responsible_profile_id` för uppdraget och även fastighetens `owner` för ett länkat besiktningsobjekt, med korrekt organisationsbindning. Administratörsrollen ger inget undantag. Den äldre servicefunktionen för start/återutgivning har samma ägarkrav. Ett uppdrag flyttas inte till en annan ägare av denna ändring.

Migrationen sätter restriktiva läs- och skrivregler på följande befintliga tabeller, utöver deras tidigare regler:

- `assignments` och `assignment_links`
- `assignment_acceptances` och `assignment_addon_orders`
- `assignment_confirmation_snapshots` och `assignment_confirmation_pdfs`
- `assignment_link_incidents` och `outbound_messages`

Reglerna gäller ÖB/STATUS. Andra uppdragstyper behåller sina tidigare regler. Meddelanden utan `assignment_id` behåller tidigare regler; deras eventuella historiska koppling kan inte gissas. TU/EB:s egna tabeller och kundregistret ändras inte. Besiktnings- och undertabellernas direkta RLS förblir ägarstyrd. Kollegans rapport måste läsas genom serverns kontrollerade läsväg.

`ob_list_organization_inspections` och `ob_overview_page` returnerar `canEdit=false` för kollegors rader. Översikten använder den inloggades `auth.uid()`, kontrollerar alla källor uttryckligen och lämnar endast sin tidigare sammanfattning plus redigeringsflaggan. Den ger inte klienten direkt läsrätt till rapporttabellerna. Befintlig paginering, sökning och antal behålls.

Avaktivering av medlemskap eller förlust av faktisk modulåtkomst nollställer flaggan och ökar revisionen. Fördröjda grantkontroller gör att medlemseditorns tillfälliga av/på-skrivningar inom samma transaktion inte tappar ett fortsatt giltigt val. Utlöpta tilldelningar nekas omedelbart vid läsning, och förnyelse eller ersättning av ett utlöpt grant återställer inte gammal kollegeläsning. Återaktivering kräver ett nytt administratörsval.

Verifiera manuellt med två besiktningsmän i samma organisation och en tredje i annan organisation: eget före aktivering, kollegors lista och rapport efter aktivering, inga start-/skicka-/ändra-/raderaåtgärder på kollegans uppdrag, återkallad åtkomst samt TU/EB:s befintliga flöden. Testa både ÖB och STATUS. Kör inget testutskick till riktiga kunder.

Lokala databastester: `node --experimental-strip-types --test test/ob-member-visibility-sql.test.ts`. Dessa använder isolerad PGlite och kör inte produktions-SQL.

Vid problem kan flaggorna stängas av via ordinarie administratörsfunktion. Behåll de restriktiva skrivrättigheterna och radera inte tabellen eller återställ äldre breda policys som automatisk rollback. En appåterställning behöver granskas eftersom den tidigare appen inte presenterar dessa separata läsrättigheter.
