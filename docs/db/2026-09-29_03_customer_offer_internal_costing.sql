-- Gizmo: private purchase/markup worksheets, separate from customer snapshots.
-- Prerequisites: 2026-09-29_01 and 2026-09-29_02.
-- Existing offers and prices are not changed. Run before enabling the new UI.
begin;

alter table public.action_case_customer_offer_drafts
  add column if not exists internal_costing jsonb not null default '{}'
  check (jsonb_typeof(internal_costing) = 'object');

comment on column public.action_case_customer_offer_drafts.internal_costing is
  'Internal pricing worksheets only. Not part of body, published snapshots, email or customer portal.';

-- Delegate authorization, row locks, revisions and accepted-offer protection to
-- the existing writer. Both writes commit or roll back in the same transaction.
create or replace function public.save_customer_offer_costing(
  p_org_id uuid, p_case_id uuid, p_user_id uuid, p_data jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare result jsonb;
begin
  if jsonb_typeof(p_data->'costing') is distinct from 'object'
    or octet_length((p_data->'costing')::text) > 1048576 then
    raise exception 'CUSTOMER_OFFER_INVALID';
  end if;
  result := public.write_customer_offer(p_org_id,p_case_id,p_user_id,'save',p_data);
  update public.action_case_customer_offer_drafts
    set internal_costing=p_data->'costing'
    where action_case_id=p_case_id and org_id=p_org_id;
  if not found then raise exception 'CUSTOMER_OFFER_NOT_FOUND'; end if;
  return result;
end $$;

revoke all on function public.save_customer_offer_costing(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_customer_offer_costing(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
