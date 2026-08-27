# Drift av Uppdrags påminnelsekö

Migrationen `docs/db/2026-08-27_02_task_reminder_schedule_and_supabase_cron.sql`
gör Supabase Cron till den primära väckarklockan för Uppdrags befintliga,
beständiga jobbkö. Ett centralt dispatchjobb anropar
`/api/cron/tasks/followup` var femte minut. Ett separat dagligt
underhållsjobb behåller 30 dagars körhistorik i `cron.job_run_details` och 90
dagar av avslutade köjobb.

Inga endpointvärden eller hemligheter finns i migrationen. Cronanropet läser
dem från Supabase Vault vid varje körning.

## 1. Förutsättningar

- Migrationen ska vara körd i produktionsdatabasen.
- `CRON_SECRET` ska finnas i Vercels produktionsmiljö och bestå av minst 16
  tecken.
- Produktionsadressen ska använda HTTPS och sluta exakt med
  `/api/cron/tasks/followup`, utan avslutande snedstreck, parametrar eller
  fragment. Det undviker en 308-omdirigering som `pg_net` inte ska förutsättas
  följa.
- Supabase-tilläggen `pg_cron`, `pg_net` och `supabase_vault` ska vara aktiva.

## 2. Lägg värdena i Vault

Använd **Supabase Dashboard → Database → Vault**. Lägg till exakt två
namngivna hemligheter:

| Vault-namn | Värde |
| --- | --- |
| `hushub_task_followup_endpoint_url` | Fullständig HTTPS-adress till produktionsendpointen |
| `hushub_task_followup_cron_secret` | Exakt samma värde som Vercels `CRON_SECRET` |

Vault-gränssnittet är förstahandsvägen. Skriv inte hemligheten i en migration,
sparad SQL-fråga, terminalhistorik eller supportlogg.

När båda värdena finns körs den parameterlösa installationen i SQL Editor:

```sql
select public.configure_task_followup_cron();
```

Funktionen validerar bara de fasta Vault-namnen och aktiverar det namngivna
femminutersjobbet. Ingen hemlighet returneras.

Migrationen kan köras innan Vault har konfigurerats. Dispatchjobbet skapas inte
av migrationen, medan det separata städjobbet skapas aktivt. Det är först ett
lyckat anrop till `configure_task_followup_cron()` som skapar och aktiverar
dispatchjobbet. En senare omkörning av migrationen ändrar inte ett redan
konfigurerat dispatchjobb.

Om ett aktivt jobb senare saknar giltig Vault-konfiguration kastar
`invoke_task_followup_cron()` ett tydligt konfigurationsfel. Cronkörningen ska
då synas som misslyckad och larmas; den får aldrig se falskt grön ut efter att
en hemlighet har tagits bort eller blivit ogiltig.

## 3. Verifiera installationen

Kontrollera säker status utan att läsa de dekrypterade värdena:

```sql
select public.task_followup_cron_configuration_status();
```

Förväntat efter den första körningen:

- `endpointConfigured` och `secretConfigured` är `true`;
- `active` är `true`;
- `schedule` är `*/5 * * * *`;
- `latestRunStatus` blir `succeeded` efter en cronpassage.

Kontrollera de två namngivna jobben:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'hushub-task-followup-dispatch-v1',
  'hushub-cron-history-cleanup-v1'
)
order by jobname;
```

`pg_net` är asynkront. En lyckad cronrad betyder därför att HTTP-anropet
köades, inte att endpointen svarade 200. Kontrollera de senaste svaren vid
driftsättning eller larm:

```sql
select id, status_code, timed_out, error_msg, created
from net._http_response
order by created desc
limit 20;
```

Endpointen ska svara **HTTP 200** med JSON som innehåller `ok: true`. 401 betyder
att Vault-hemligheten och Vercels `CRON_SECRET` inte är identiska. 503 betyder
att endpointen eller jobbhanteringen inte är korrekt konfigurerad.

## 4. Sändfönster och tidszon

Varje organisation har följande standard:

- tidszon `Europe/Stockholm`;
- automatiska påminnelser tillåtna kl. 07:00–20:00 lokal tid;
- alla veckodagar tillåtna.

`due_at` är fortfarande ett absolut `timestamptz`. Den nya
`operational_tasks.due_timezone` är en oföränderlig IANA-zonsnapshot som bevarar
hur deadlinen avsågs visas även om organisationens standardzon senare ändras.

Automation använder denna service-rollsfunktion för att skjuta en nattlig
kandidat till första tillåtna tid:

```sql
select public.task_next_allowed_reminder_at(
  '<organization-uuid>'::uuid,
  timestamptz '2026-08-30 03:00:00+02'
);
```

Med standardinställningen blir resultatet 2026-08-30 kl. 07:00 svensk tid.
Funktionen hanterar sommar-/vintertid via organisationens IANA-zon och returnerar
aldrig en tid före kandidaten.

Manuellt användarutlösta meddelanden och den första uppdragstilldelningen kan
fortsätta vara direkta produktmeddelanden. Sändfönstret ska användas för
automatiska påminnelser, statusfrågor och eskaleringar.

## 5. Kö- och felövervakning

Kontrollera köfördröjning:

```sql
select
  status,
  count(*) as jobs,
  min(available_at) as oldest_available_at,
  now() - min(available_at) as oldest_delay
from public.task_automation_jobs
where status in ('queued', 'failed', 'processing', 'dead_letter')
group by status
order by status;
```

Larma åtminstone på:

- mogna `queued`/`failed`-jobb äldre än 15 minuter;
- varje nytt `dead_letter`-jobb;
- tre efterföljande cron- eller HTTP-fel;
- 401/403/5xx eller timeout från followup-endpointen.

Kontrollera också leveranser vars providerutfall är okänt:

```sql
select
  id,
  org_id,
  task_id,
  channel,
  provider,
  error_message,
  updated_at
from public.task_message_deliveries
where status = 'ambiguous'
order by updated_at;
```

`ambiguous` betyder att leverantören kan ha accepterat meddelandet trots att
HusHub fick timeout, nätfel, 5xx eller ett oanvändbart svar. HusHub gör därför
varken automatisk retry eller utskick i reservkanalen och pausar nya
automatiska leveranser för uppdraget. Jobbet pollar inte leveransen timvis;
resolutionen nedan återköar aktuell uppdragsversion när utfallet är känt.

Kontrollera först leverantörens logg eller verifierade webhook. Kör sedan exakt
en av följande service-role-anrop. `sent` kräver leverantörens meddelande-id:

```sql
select public.resolve_task_message_delivery(
  p_delivery_id => '<delivery-uuid>'::uuid,
  p_resolution => 'sent',
  p_provider_message_id => '<provider-message-id>',
  p_note => 'Verifierad i leverantörens logg av driftansvarig YYYY-MM-DD.'
);
```

Använd `failed` bara när leverantören säkert har bekräftat att meddelandet inte
skickades:

```sql
select public.resolve_task_message_delivery(
  p_delivery_id => '<delivery-uuid>'::uuid,
  p_resolution => 'failed',
  p_provider_message_id => null,
  p_note => 'Bekräftat ej skickat av leverantörens support, ärende ABC-123.'
);
```

RPC:n låser och verifierar att leveransen fortfarande är `ambiguous`, skriver
en append-only `delivery_reconciled`-händelse och återköar aktuell aktiv
uppdragsversion. Vid bekräftat fel återkallas en oanvänd direktlänk bara när den
hör exklusivt till leveransen; en aktiveringsmejl-länk som även skickats via
WhatsApp lämnas orörd. E-post kan därefter göra ett nytt, separat idempotent
försök med en ny direktlänk.
WhatsApp-försöket spelas aldrig upp automatiskt; en separat konfigurerad
reservkanal kan fortfarande användas. Funktionen är endast tilldelad
`service_role`. Kör inte en direkt `update` på leveranstabellen och skriv aldrig
hemligheter, bearer-länkar eller personuppgifter i operatörsanteckningen.

Om även den konfigurerade reservleveransen är definitivt uttömd skickar Gizmo
en enda idempotent eskalering till uppdragsansvarig. Den omöjliga leveransen
försöks inte igen och uppdragets automation pausas tills en människa ändrar
uppdraget.

Jobb claimas atomiskt med `FOR UPDATE SKIP LOCKED`, och både jobb och leveranser
har unika idempotensnycklar. Det gör samtidiga cronanrop säkra. Externa
leverantörer ger däremot inte en absolut exactly-once-garanti. E-post använder
en provider-idempotensnyckel bunden till exakt försök och dess personliga länk.
Osäkra providerfall spelas inte upp utan stannar i `ambiguous` tills de har
stämts av manuellt eller via en framtida verifierad webhook.

Uppdragsmejlens Resend-timeout är hårt begränsad till högst 10 sekunder
(`RESEND_REQUEST_TIMEOUT_MS`, standard 10000). Höj inte gränsen: cronrutten
startar jobb endast under sina första 10 sekunder för att ett redan startat
provideranrop ska hinna avslutas inom Vercels 60-sekundersgräns.

## 6. Rotation och avstängning

Vid rotation av `CRON_SECRET`:

1. pausa dispatchjobbet i Supabase Cron;
2. uppdatera Vercels produktionshemlighet och driftsätt;
3. uppdatera det fasta Vault-värdet via Vault-gränssnittet;
4. kör `select public.configure_task_followup_cron();` för att validera och
   återaktivera jobbet;
5. verifiera ett 200-svar i `net._http_response`.

Supabase Cron är den enda schemaläggaren. Återinför inte ett parallellt
Vercel-schema. Endpointen kan anropas manuellt med korrekt behörighet vid
felsökning, men det är en diagnostisk engångskörning och ingen reserv-cron.

Det dagliga underhållsjobbet kör
`public.run_task_automation_maintenance()` kl. 02:17 UTC. Det behåller 30 dagar
av `cron.job_run_details` för de två namngivna HusHub-jobben och 90 dagar av
Uppdrags `completed`/`cancelled`-köjobb. `failed`, `processing` och
`dead_letter` raderas aldrig av retentionsjobbet, och inte heller affärsrevision
i händelser, meddelanden eller leveranser. Andra modulers cronhistorik berörs
inte.

Service role kan vid behov köra samma underhåll kontrollerat och se antalet
rader som togs bort:

```sql
select public.run_task_automation_maintenance();
```

Sänk inte köjobbens retention under 30 dagar eller cronhistoriken under sju
dagar; felsökning och leveransrevision behöver ett rimligt historikfönster.

## 7. Säker rollback

Rulla aldrig tillbaka applikationen till en worker som inte förstår statusen
`ambiguous` medan en sådan leverans finns. En äldre worker kan annars behandla
ett okänt providerutfall som ett vanligt fel och skapa ett dubbelutskick.

1. Pausa `hushub-task-followup-dispatch-v1` i Supabase Cron.
2. Stoppa även opportunistiska Uppdrag-batcher. De kan startas av API-anrop när
   uppdrag skapas eller hanteras, så pausad cron räcker inte; använd
   underhållsläge eller driftsätt en forward-fix som stänger automationen.
3. Vänta ut redan startade anrop och kontrollera:

   ```sql
   select count(*) as unresolved_deliveries
   from public.task_message_deliveries
   where status = 'ambiguous';
   ```

4. Resultatet måste vara `0`. Stäm annars av varje leverans med providern och
   använd `resolve_task_message_delivery()` enligt avsnitt 5.
5. Först därefter får en äldre appversion startas. Återaktivera dispatchern med
   `select public.configure_task_followup_cron();` när den kompatibla workern är
   driftsatt och verifierad.
