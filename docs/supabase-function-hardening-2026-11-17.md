# Supabase: funktioner och behörigheter, 17 november 2026

Funktionsgranskningen och migrationerna 04–07 är genomförda i produktion.
Security Advisor visar efter uppdatering **0 fel, 42 varningar och 149
informationsposter**. Onödiga rättigheter har tagits bort, 32 funktioner har
fått låst namnuppslagning och ett faktiskt behörighetsfel vid skapande av
underuppdrag har rättats. Alla varningar är inte borttagna.

Detta kompletterar [den inledande säkerhetsgranskningen](supabase-security-review-2026-11-17.md).

| Security Advisor | Ursprungligen | Efter 01–03 | Slutligt efter 04–07 |
|---|---:|---:|---:|
| Fel | 33 | 0 | 0 |
| Varningar | 142 | 141 | 42 |
| Information | 124 | 149 | 149 |

## Genomförda ändringar

- [04: låst `search_path`](db/2026-11-17_04_function_search_paths.sql) sätter
  `pg_catalog, pg_temp` på de 32 granskade funktioner som saknade fast sökväg.
  Deras applikationsreferenser är redan kvalificerade med `public` eller `auth`.
  Funktionskroppar och rättigheter ändras inte. Den aktuella `moddatetime()`
  verifierades som en vanlig PL/pgSQL-funktion, inte ett extensionägt C-objekt.
- [05: triggerfunktioner](db/2026-11-17_05_trigger_function_execute.sql) tar
  bort EXECUTE för PUBLIC, `anon` och `authenticated` på 31 verifierade
  SECURITY DEFINER-triggerfunktioner. Befintliga triggers och åtkomst för
  ägare och service-roll bevaras.
- [06: interna hjälpfunktioner](db/2026-11-17_06_internal_function_execute.sql)
  tar bort anonym EXECUTE på fyra organisations-/administratörspredikat.
  Inloggad åtkomst bevaras för deras 184 unika policyberoenden. Den interna
  `task_access_link_covers` begränsas till ägare/service-roll; dess sju
  anropare är granskade, postgresägda SECURITY DEFINER-funktioner.
- [07: behörighet till föräldrauppdrag](db/2026-11-17_07_task_parent_authorization.sql)
  rättar endast två jämförelser i `create_operational_task` till
  `IS DISTINCT FROM`.

Felet i 07 gällde ett föräldrauppdrag tilldelat en extern kontakt. Då är
`assignee_profile_id` NULL. Den tidigare jämförelsen med `<>` kunde ge NULL
i stället för sant, så en annan aktiv organisationsmedlem kunde passera
kontrollen trots att personen saknade den avsedda föräldrarollen. RPC:n var
avsiktligt tillgänglig för inloggade användare; servergränssnittets kontroller
räckte därför inte för att skydda ett direkt RPC-anrop.

Den aktuella hierarkitriggern och övriga INSERT-triggers granskades och innehöll
ingen kompletterande kontroll som stängde denna lucka. Rättningen nekar det
fallet och behåller tillåtna fall för uppdragsgivare, intern mottagare och
administratör. De två granskade besluts-RPC:erna hade inte samma NULL-fel:
uppdragsgivarens ID är obligatoriskt och aktörskontrollerna är uttryckliga.
Detta är en rättad kodbrist, inte ett konstaterande om tidigare utnyttjande.

Ingen migration ger nya GRANT-rättigheter eller ändrar kundrader. Funktionernas
signaturer, argumentstandardvärden, ägare och service-åtkomst bevaras.

## Verifiering

[Funktionsregressionen](../scripts/test-function-hardening.mjs) klarade 680
kontroller och [regressionen för föräldrauppdrag](../scripts/test-task-parent-authorization.mjs)
38, totalt **718 kontroller med syntetiska data i PGlite/PostgreSQL 18.3**.
Den tidigare RLS-regressionens 310 kontroller redovisas i grundrapporten.

Proven omfattar källkods- och attributbevarande, rollrättigheter, avbrutna
omkörningar vid oväntad drift, tillåten omkörning där avsett, befintlig
triggerkörning utan klient-EXECUTE samt ägarens möjlighet att återskapa en
trigger. För 07 reproducerades den tidigare luckan före rättning och nekades
efter rättning; tillåtna roller, främmande organisation och saknad modulåtkomst
kontrollerades också.

Produktionsprojektet kör PostgreSQL 17.6. Efter körningarna verifierades metadata
för 81 funktioner: 32 sökvägsändringar, 31 trigger-ACL:er, fem hjälp-ACL:er och
exakt en avsedd ändring av en funktionskropp. Övriga kroppar, ägare, signaturer,
attribut, triggerbindningar och service-åtkomst var bevarade. Ett separat
läsande teckenkodningsprov gav oförändrade resultat för `Här`, `plain` och NULL.

Läsande HTTP-prov efter ändringarna visade:

- Fyra interna organisations-/administratörspredikat nekar anonym RPC med
  HTTP 401. Tre avsiktligt anonyma OB-gränspredikat svarar HTTP 200 och false
  för syntetiska, obehöriga ID:n.
- Anonym listning av `inspection-images` och `property-media` svarar HTTP 200
  med tom lista. Metadata visar samtidigt restriktiva ägar- och organisations-
  gränser. Proven avgör inte vilka enskilda publika fil-URL:er som avsiktligt
  ska vara offentliga.
- Direkt anonym läsning nekar 33 tabeller med HTTP 401; de tre publika
  plattformskatalogerna svarar HTTP 200. Service-rollens 36 tabellprov svarar
  HTTP 200 med `limit=0`, utan läsning av kundinnehåll.
- RenoApps publika föreningslista och ansökningskonfiguration fungerar.
  Konfigurationens kontrollsumma är oförändrad; fyra listade föreningar,
  tolv åtgärdstyper och sexton frågor finns kvar.

Migration 05 låser granskade funktionsidentiteter, källkodshashar och antal
triggerbindningar. Före-/efterjämförelser visar att körningen inte ändrade
bindningarna; de är inte ett bevis för att varje bindningsdefinition varit
oförändrad historiskt.

## De 42 kvarstående varningarna

Den uppdaterade Advisor-exporten innehåller exakt följande:

| Klass | Antal | Bedömning |
|---|---:|---|
| SECURITY DEFINER med EXECUTE för inloggad roll | 18 | Avsedda policyhjälpare och RPC:er med uttryckliga kontroller |
| SECURITY DEFINER med EXECUTE för anonym roll | 3 | OB-gränspredikat som används av restriktiva policyer för samma roll |
| Policy med generellt sant uttryck | 19 | Äldre tillåtande policyer kombineras med granskade restriktiva gränser |
| Publik Storage-bucket med listningsvarning | 2 | Restriktiva gränser och tomma anonyma listningsprov verifierade |

De 21 EXECUTE-varningarna gäller 18 unika funktioner; de tre anonyma funktionerna
ingår även i gruppen med inloggad åtkomst. Aktuella funktionskroppar granskades,
inte enbart avsikten i äldre dokumentation:

| Funktioner | Verifierad gräns |
|---|---|
| `is_org_member`, `is_org_admin`, `is_hushub_besiktapp_admin`, `is_hushub_renoapp_admin` | Egen `auth.uid()`, aktivt medlemskap eller betrodd administratörstilldelning |
| `has_operational_task_module_access`, `can_view_operational_task`, `can_work_operational_task`, `can_manage_operational_task` | Aktiv organisation/modul, aktörens roll eller uppdragsrelation; arkiverade uppdrag filtreras |
| `create_operational_task`, `decide_operational_task_requirement`, `decide_operational_task_deadline_change` | Identitet, organisation/modul, relevanta uppdragsroller, versionskontroller; föräldrakontrollen rättad i 07 |
| `ob_assignment_visibility_access`, `ob_assignment_link_visibility_access` | Egen aktör, ansvarig eller uttrycklig kollegiebehörighet och organisationsbunden besiktning |
| `ob_overview_page`, `ob_overview_item_flags` | Inledande aktörs-/organisationskontroll, uttryckliga synlighetsfilter och begränsade anropsparametrar |
| `ob_inspection_matches_organization`, `ob_organization_row_access`, `ob_organization_storage_access` | Ägare/organisation inom OB; avsiktlig genomsläppning av objekt utanför den egna modulgränsen |

Samtliga är postgresägda, har fast `search_path` och använder uttryckliga
`public`-/`auth`-referenser till verksamhetstabeller. Ingen dynamisk SQL hittades
i dessa 18 kroppar. Klientrollerna saknar CREATE i berörda schemas.
Genomsläppningen i OB-hjälparna är inte en fristående åtkomstbeviljning: övriga
policyer måste också tillåta operationen.

En äldre kommentar i `ob_overview_page` säger att läsningarna körs med anroparens
RLS. Funktionen är i själva verket SECURITY DEFINER och förlitar sig på sina
uttryckliga organisations- och synlighetskontroller. Kommentaren ska inte
användas som bevis för att anroparens RLS tillämpas.

## Spårbarhet och avgränsningar

Körningarna i SQL Editor rapporterade `Success. No rows returned`. Sparade
kvitton och SHA-256 knyter dem till de granskade artefakterna:

- `apply-reviewed-function-hardening.sql` (04–06):
  `b0502accc968e5c6f8aaeb6cb948b2907c860e9b27037fc7de4fead5216081b0`.
- `apply-reviewed-task-parent-authorization.sql` (07):
  `3a1f7ee8833e39f76b606cbaf045765970dfe4b3d993316f681129f0d2e2fa19`.
- Källfil 07:
  `752c477622437379a4feb3db1db2cbdf7d2a1f2837658cd6edd37ed9c930b4f8`.
- Korrigerad `create_operational_task`-kropp, MD5:
  `e9567246777362890c7599bdd5d42f3b`.

Underlaget sparas separat, bland annat `functions-before.json`,
`function-dependencies-all-schemas-before.json`, `task-parent-guards-before.json`,
`function-hardening-test-results.json`, `task-parent-authorization-test-results.json`,
`function-hardening-execution-receipt.json`,
`task-parent-authorization-execution-receipt.json`, `function-metadata-final.json`,
`function-metadata-verification-final.json`, `function-http-after.json`,
`http-functions-after.json`, `encoding-before.json`, `encoding-after.json`,
`advisor-functions-after.json` och `security-warnings-functions-after.csv`.

Ingen historisk åtkomstutredning eller fullständig provkörning av skrivflöden
med verklig inloggad produktionsanvändare ingick. Syntetiska skrivprov gjordes
lokalt; produktionskontrollerna använde metadata och läsande anrop. Granskningen
fastställer inte om historisk obehörig åtkomst har förekommit.
