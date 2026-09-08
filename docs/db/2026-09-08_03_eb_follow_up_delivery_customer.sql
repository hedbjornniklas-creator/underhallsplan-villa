-- Apply after 2026-09-08_01_eb_follow_up_customer.sql and before publishing
-- the delivery-based customer flow. No existing contacts or orders are changed.
begin;

-- The authenticated delivery API authorizes org/inspection access before this
-- service-only call. Its explicitly named "Beställare – huvudmottagare" address
-- becomes the customer only once. Suggestions alone never call this function.
create or replace function public.eb_initialize_follow_up_delivery_customer(
  p_org_id uuid,p_project_id uuid,p_inspection_id uuid,p_email text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_existing text;
  v_now timestamptz := clock_timestamp();
begin
  if v_email is null or length(v_email)>254 or
      v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'EB_FOLLOW_UP_EMAIL_INVALID';
  end if;
  if p_actor is null or not exists(select 1 from profiles where id=p_actor) then
    raise exception 'EB_FOLLOW_UP_ACTOR_INVALID';
  end if;
  -- The exact same lock is used for purchases and explicit contact corrections.
  -- A purchase that wins the race keeps its frozen buyer; initialization that
  -- wins the race is immediately enforced by the existing order insert guard.
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-order:'||p_inspection_id::text,0));
  if not exists(select 1 from eb_inspection_details d join eb_projects p on p.id=d.eb_project_id and p.org_id=d.org_id
    where d.inspection_id=p_inspection_id and d.eb_project_id=p_project_id and d.org_id=p_org_id) then
    raise exception 'EB_INSPECTION_NOT_FOUND';
  end if;
  select lower(btrim(buyer_snapshot->>'email')) into v_existing from eb_follow_up_orders
    where inspection_id=p_inspection_id and org_id=p_org_id and eb_project_id=p_project_id;
  if found then
    if length(v_existing)>254 or v_existing !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      v_existing := null;
    end if;
    return jsonb_build_object('email',v_existing,'established',true,'purchased',true);
  end if;
  select email into v_existing from eb_follow_up_customers
    where inspection_id=p_inspection_id and org_id=p_org_id and eb_project_id=p_project_id;
  if found then
    return jsonb_build_object('email',v_existing,'established',true,'purchased',false);
  end if;
  insert into eb_follow_up_customers(inspection_id,org_id,eb_project_id,email,confirmed_at,confirmed_by)
    values(p_inspection_id,p_org_id,p_project_id,v_email,v_now,p_actor);
  insert into eb_follow_up_customer_audit(inspection_id,org_id,eb_project_id,previous_email,email,confirmed_at,confirmed_by)
    values(p_inspection_id,p_org_id,p_project_id,null,v_email,v_now,p_actor);
  return jsonb_build_object('email',v_email,'established',true,'purchased',false);
end $$;

revoke all on function public.eb_initialize_follow_up_delivery_customer(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.eb_initialize_follow_up_delivery_customer(uuid,uuid,uuid,text,uuid) to service_role;
comment on function public.eb_initialize_follow_up_delivery_customer(uuid,uuid,uuid,text,uuid) is
  'First report delivery records its explicitly identified customer. Idempotent under the purchase lock; never changes an established contact or frozen buyer.';
commit;
