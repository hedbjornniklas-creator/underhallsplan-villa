-- OB overview: filter/count/page the lightweight rows before reading workflow state.
-- Prerequisites: assignment/org RLS, OB early-start/reconciliation and link incidents.
-- No inspection, assignment or workflow records are changed by this migration.
-- Deploy this transaction BEFORE the application version that calls ob_overview_page.
-- The API must call it with the authenticated user's client, not service_role.
-- Rollback: deploy the previous overview loader first, then run:
--   begin;
--   drop function if exists public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer);
--   drop function if exists public.ob_overview_item_flags(uuid,uuid,uuid);
--   notify pgrst, 'reload schema';
--   commit;
-- The named collation can remain: it contains no user data and changes no existing
-- column's ordering. Do not drop it if another deployed function has adopted it.
begin;

-- Production PostgreSQL can use Swedish ICU ordering. The fallback retains Swedish
-- a-z, å, ä, ö order through the explicit sort-key translation below.
do $$
begin
  if exists (select 1 from pg_catalog.pg_collation where collprovider = 'i') then
    execute 'create collation if not exists public.ob_overview_swedish (provider = icu, locale = ''sv-SE'')';
  else
    execute 'create collation if not exists public.ob_overview_swedish from "C"';
  end if;
end;
$$;

-- Only the flags already exposed by the overview are returned. In particular this
-- does not expose the privileged workflow RPC's customer snapshots/review tokens.
create or replace function public.ob_overview_item_flags(
  p_org_id uuid, p_assignment_id uuid, p_workflow_inspection_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare
  a public.assignments;
  current_assignment_id uuid;
  state jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_org_member(p_org_id), false) then
    raise exception 'OB_OVERVIEW_ORG_FORBIDDEN' using errcode = '42501';
  end if;

  if p_assignment_id is not null then
    select * into a from public.assignments
      where id = p_assignment_id and org_id = p_org_id and assignment_type = 'OB';
    if not found then
      raise exception 'OB_OVERVIEW_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if p_workflow_inspection_id is not null then
    select w.current_assignment_id into current_assignment_id
      from public.ob_assignment_workflows w
      join public.assignments current_a on current_a.id = w.current_assignment_id
      where w.inspection_id = p_workflow_inspection_id and w.org_id = p_org_id
        and current_a.org_id = p_org_id and current_a.assignment_type = 'OB';
    if not found then
      raise exception 'OB_OVERVIEW_WORKFLOW_FORBIDDEN' using errcode = '42501';
    end if;
    if p_assignment_id is not null and p_assignment_id <> current_assignment_id then
      raise exception 'OB_OVERVIEW_WORKFLOW_CHANGED';
    end if;
    state := public.ob_assignment_workflow_state(p_workflow_inspection_id);
    if state is null or (state->>'assignmentId')::uuid is distinct from current_assignment_id then
      raise exception 'OB_OVERVIEW_WORKFLOW_CHANGED';
    end if;
  end if;

  return jsonb_build_object(
    'activeLink', exists (select 1 from public.assignment_links l
      where l.assignment_id = a.id and l.org_id = p_org_id and l.used_at is null
        and l.revoked_at is null and l.expires_at > now()),
    'approvalVerified', a.accepted_at is not null and exists (
      select 1 from public.assignment_acceptances accepted
      where accepted.assignment_id = a.id and accepted.org_id = p_org_id
        and accepted.accepted_at = a.accepted_at),
    'linkIssue', exists (select 1 from public.assignment_link_incidents incident
      where incident.assignment_id = a.id and incident.org_id = p_org_id and incident.resolved_at is null),
    'assignmentId', case when state is null then to_jsonb(a.id) else state->'assignmentId' end,
    'needsReview', coalesce((state->>'needsReview')::boolean, false),
    'paused', coalesce((state->>'paused')::boolean, false),
    'reason', state->'reason'
  );
end;
$$;

create or replace function public.ob_overview_page(
  p_org_id uuid,
  p_search text default '',
  p_filter text default 'all',
  p_sort text default 'date-desc',
  p_attention_only boolean default false,
  p_show_archived boolean default false,
  p_page integer default 1,
  p_page_size integer default 10
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public as $$
declare
  result jsonb;
  use_icu boolean;
begin
  if auth.uid() is null or not coalesce(public.is_org_member(p_org_id), false) then
    raise exception 'OB_OVERVIEW_ORG_FORBIDDEN' using errcode = '42501';
  end if;
  if p_page is null or p_page not between 1 and 999999
    or p_page_size is null or p_page_size not in (10, 25, 50) then
    raise exception 'OB_OVERVIEW_PAGE_INVALID' using errcode = '22023';
  end if;
  if char_length(coalesce(p_search, '')) > 200 then
    raise exception 'OB_OVERVIEW_SEARCH_INVALID' using errcode = '22023';
  end if;
  if p_filter is null or p_filter not in ('all', 'active', 'closed')
    or p_sort is null or p_sort not in ('date-desc', 'date-asc', 'customer', 'address') then
    raise exception 'OB_OVERVIEW_FILTER_INVALID' using errcode = '22023';
  end if;
  p_attention_only := coalesce(p_attention_only, false);
  p_show_archived := coalesce(p_show_archived, false);
  -- Some runtimes expose ICU but ship only root-locale data. Use it only when
  -- Swedish letter ordering actually works, otherwise use the explicit C key.
  select collprovider = 'i'
    and ('z' collate public.ob_overview_swedish < 'å' collate public.ob_overview_swedish)
    and ('å' collate public.ob_overview_swedish < 'ä' collate public.ob_overview_swedish)
    and ('ä' collate public.ob_overview_swedish < 'ö' collate public.ob_overview_swedish)
    into use_icu from pg_catalog.pg_collation
    where oid = 'public.ob_overview_swedish'::regcollation;

  with
  -- These reads deliberately run as the authenticated caller: owner checks do
  -- not replace any additional RLS restrictions on inspections or snapshots.
  owned_properties as materialized (
    select p.id, p.address, p.city, p.client_name
    from public.properties p where p.owner = auth.uid()
  ),
  visible_inspections as materialized (
    select i.id, i.property_id, i.status, i.date, i.created_at, i.assignment_number,
      i.customer_name, i.client_name,
      coalesce(s.address, p.address) as address,
      coalesce(s.city, p.city) as city,
      coalesce(s.client_name, p.client_name) as snapshot_customer
    from public.inspections i join owned_properties p on p.id = i.property_id
    left join public.ob_property_snapshot s on s.inspection_id = i.id
    where i.inspection_family = 'OB'
  ),
  scoped_assignments as materialized (
    select a.id, a.inspection_id, a.status, a.customer_name, a.customer_email,
      a.property_address, a.preliminary_address, a.property_city, a.preferred_date,
      a.accepted_at, a.booked_at, a.archived_at, a.created_at
    from public.assignments a where a.org_id = p_org_id and a.assignment_type = 'OB'
  ),
  scoped_workflows as materialized (
    select w.inspection_id, w.current_assignment_id, w.initial_assignment_id
    from public.ob_assignment_workflows w where w.org_id = p_org_id and (
      exists (select 1 from scoped_assignments a where a.id = w.current_assignment_id)
      or exists (select 1 from visible_inspections i where i.id = w.inspection_id))
  ),
  linked_assignments as materialized (
    select inspection_id, count(*) as candidate_count, (array_agg(id order by id))[1] as first_id
    from scoped_assignments where inspection_id is not null group by inspection_id
  ),
  workflow_rows as (
    select a.id as assignment_id, i.id as inspection_id, w.inspection_id as workflow_inspection_id,
      case when a.id is not null then to_jsonb(a) end as assignment,
      case when i.id is not null then to_jsonb(i) end as inspection,
      to_jsonb(w) as workflow
    from scoped_workflows w left join scoped_assignments a on a.id = w.current_assignment_id
    left join visible_inspections i on i.id = w.inspection_id
  ),
  legacy_rows as materialized (
    select a.id as assignment_id, i.id as inspection_id, null::uuid as workflow_inspection_id,
      case when a.id is not null then to_jsonb(a) end as assignment,
      to_jsonb(i) as inspection, null::jsonb as workflow
    from visible_inspections i
    left join linked_assignments linked on linked.inspection_id = i.id and linked.candidate_count = 1
    left join scoped_assignments a on a.id = linked.first_id
    where not exists (select 1 from scoped_workflows w where w.inspection_id = i.id)
  ),
  consumed_assignments as (
    select initial_assignment_id as id from scoped_workflows
    union select current_assignment_id from scoped_workflows
    union select a.id from scoped_assignments a join scoped_workflows w on w.inspection_id = a.inspection_id
    union select assignment_id from legacy_rows where assignment_id is not null
  ),
  graph_rows as (
    select * from workflow_rows
    union all select * from legacy_rows
    union all
    select a.id, null::uuid, null::uuid, to_jsonb(a), null::jsonb, null::jsonb
    from scoped_assignments a where not exists (select 1 from consumed_assignments c where c.id = a.id)
  ),
  display_rows as (
    select g.*,
      case when inspection_id is not null then 'inspection:' || inspection_id else 'assignment:' || assignment_id end as item_id,
      coalesce(nullif(btrim(inspection->>'date'), ''), nullif(btrim(assignment->>'preferred_date'), '')) as display_date,
      coalesce(inspection->>'created_at', assignment->>'created_at')::timestamptz as created_at,
      coalesce(nullif(btrim(inspection->>'address'), ''), nullif(btrim(assignment->>'property_address'), ''),
        nullif(btrim(assignment->>'preliminary_address'), ''), 'Adress saknas') as address,
      coalesce(nullif(btrim(inspection->>'city'), ''), nullif(btrim(assignment->>'property_city'), ''), '') as city,
      coalesce(nullif(btrim(inspection->>'customer_name'), ''), nullif(btrim(inspection->>'client_name'), ''),
        nullif(btrim(inspection->>'snapshot_customer'), ''), nullif(btrim(assignment->>'customer_name'), ''),
        nullif(btrim(assignment->>'customer_email'), ''), 'Kund saknas') as customer,
      coalesce(nullif(btrim(inspection->>'assignment_number'), ''), '') as assignment_number,
      case when inspection_id is not null then coalesce(lower(inspection->>'status') in ('archived', 'arkiverad'), false)
        else assignment->>'archived_at' is not null end as archived,
      case when inspection_id is not null then
        coalesce(lower(btrim(inspection->>'status')) in ('completed', 'done', 'klar', 'archived', 'arkiverad'), false)
        else assignment->>'inspection_id' is null and workflow is null and coalesce(assignment->>'status' = 'cancelled', false)
        end as status_closed
    from graph_rows g
  ),
  candidates as materialized (
    select d.*, d.status_closed or d.archived as closed
    from display_rows d where (p_show_archived or not d.archived)
      and not exists (
        select 1 from regexp_split_to_table(lower(btrim(coalesce(p_search, ''))), '\s+') word
        where word <> '' and strpos(lower(d.address || ' ' || d.city || ' ' || d.customer || ' ' || d.assignment_number), word) = 0
      )
  ),
  -- MATERIALIZED evaluates each privileged status read exactly once. With the
  -- default filter this CTE is empty; ordinary pagination never reads all states.
  attention_flags as materialized (
    select c.item_id, public.ob_overview_item_flags(p_org_id, c.assignment_id, c.workflow_inspection_id) as flags
    from candidates c where p_attention_only and not c.archived
  ),
  attention_candidates as materialized (
    select c.*, f.flags from candidates c left join attention_flags f using (item_id)
    where not p_attention_only or (not c.archived and (
      case when c.assignment is not null then
        case
          when c.assignment->>'status' = 'cancelled' then false
          when c.assignment->>'status' in ('expired', 'draft') then true
          when c.assignment->>'accepted_at' is not null and (f.flags->>'approvalVerified')::boolean then
            not (c.assignment->>'booked_at' is not null and c.assignment->>'status' in ('booked', 'completed'))
          when c.assignment->>'status' = 'sent' and c.assignment->>'accepted_at' is null then not (f.flags->>'activeLink')::boolean
          else true end
        else c.workflow is not null end
      or coalesce((f.flags->>'linkIssue')::boolean, false)
      or (c.inspection_id is not null and coalesce(lower(btrim(c.inspection->>'status')), '') not in
        ('draft', 'utkast', 'ongoing', 'in_progress', 'pågående', 'pågår', 'completed', 'done', 'klar', 'archived', 'arkiverad'))
      or (c.workflow is not null and ((f.flags->>'paused')::boolean or
        ((f.flags->>'needsReview')::boolean and (f.flags->>'approvalVerified')::boolean and c.assignment->>'booked_at' is not null)))
    ))
  ),
  -- Tab counts share search/archive/attention filters, but not the selected tab.
  counts as (
    select count(*) as all_count, count(*) filter (where not closed) as active_count,
      count(*) filter (where closed) as closed_count
    from attention_candidates
  ),
  filtered as materialized (
    select * from attention_candidates where p_filter = 'all'
      or (p_filter = 'active' and not closed) or (p_filter = 'closed' and closed)
  ),
  -- A stale last page after deletion/filtering resolves to the current last page.
  page_bounds as materialized (
    select count(*) as total_count,
      least(p_page::bigint, greatest(1::bigint, (count(*) + p_page_size - 1) / p_page_size)) as effective_page
    from filtered
  ),
  ordered as (
    select f.*, row_number() over (order by
      case when p_sort in ('date-desc', 'date-asc') then display_date is null end asc,
      case when p_sort = 'date-desc' then coalesce(display_date::timestamptz, created_at) end desc,
      case when p_sort = 'date-asc' then coalesce(display_date::timestamptz, created_at) end asc,
      (case when use_icu and p_sort = 'customer' then customer
        when use_icu and p_sort = 'address' then address end)
        collate public.ob_overview_swedish asc,
      (case when not use_icu and p_sort = 'customer' then translate(lower(customer), 'åäö', '{|}')
        when not use_icu and p_sort = 'address' then translate(lower(address), 'åäö', '{|}') end) collate "C" asc,
      item_id asc) as ordinal
    from filtered f
  ),
  page_rows as materialized (
    select * from ordered order by ordinal limit p_page_size
      offset (select (effective_page - 1) * p_page_size from page_bounds)
  ),
  page_flags as materialized (
    select p.*, case when p_attention_only then p.flags
      else public.ob_overview_item_flags(p_org_id, p.assignment_id, p.workflow_inspection_id) end as item_flags
    from page_rows p
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'assignment', case when p.assignment is not null then p.assignment || jsonb_build_object(
        'activeLink', p.item_flags->'activeLink', 'approvalVerified', p.item_flags->'approvalVerified', 'linkIssue', p.item_flags->'linkIssue') end,
      'inspection', p.inspection,
      'workflow', case when p.workflow is not null then p.workflow || jsonb_build_object(
        'needsReview', p.item_flags->'needsReview', 'paused', p.item_flags->'paused', 'reason', p.item_flags->'reason') end
    ) order by p.ordinal) from page_flags p), '[]'::jsonb),
    'total', (select total_count from page_bounds),
    'counts', (select jsonb_build_object('all', all_count, 'active', active_count, 'closed', closed_count) from counts),
    'page', (select effective_page from page_bounds), 'pageSize', p_page_size
  ) into result;
  return result;
end;
$$;

revoke all on function public.ob_overview_item_flags(uuid,uuid,uuid),
  public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.ob_overview_item_flags(uuid,uuid,uuid),
  public.ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
