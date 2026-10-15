-- OB / STATUS: protect approved assignment content, without rewriting any history.
-- The first customer acceptance can still complete a sent assignment's fields.
begin;

create or replace function public.ob_guard_approved_assignment_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_document jsonb := to_jsonb(old);
  new_document jsonb := to_jsonb(new);
begin
  if old.assignment_type not in ('OB', 'STATUS') then
    return new;
  end if;

  if old.accepted_at is null and old.booked_at is null
    and old.status not in ('ordered', 'booked', 'completed')
    and not exists (
      select 1 from public.assignment_acceptances ac
      where ac.assignment_id = old.id and ac.org_id = old.org_id
    ) then
    return new;
  end if;

  -- Status, archive and inspection links are operational. They must not change
  -- the agreed contents, or turn an approved document back into an editable draft.
  if (new.status = 'draft' and new.status is distinct from old.status) or exists (
    select 1 from unnest(array[
      'id', 'org_id', 'assignment_type', 'responsible_profile_id',
      'customer_name', 'customer_email', 'customer_phone', 'customer_address',
      'customer_postal_code', 'customer_city', 'preliminary_address',
      'property_address', 'property_postal_code', 'property_city',
      'property_municipality', 'property_owner_name', 'cadastral_id',
      'brf_name', 'apartment_number', 'apartment_holder_name',
      'preferred_date', 'preferred_time', 'scope_description',
      'price_amount', 'currency', 'orderer_role', 'personal_identity_number',
      'invoice_name', 'invoice_address', 'invoice_email',
      'assignment_details', 'notes_internal', 'accepted_at',
      'accepted_via_ip', 'accepted_user_agent', 'terms_version', 'terms_document_hash'
    ]) as protected(field)
    where old_document -> protected.field is distinct from new_document -> protected.field
  ) then
    raise exception 'OB_ASSIGNMENT_CONTENT_LOCKED';
  end if;
  return new;
end;
$$;

revoke all on function public.ob_guard_approved_assignment_content() from public, anon, authenticated;
drop trigger if exists ob_approved_assignment_content_lock on public.assignments;
create trigger ob_approved_assignment_content_lock
before update on public.assignments
for each row execute function public.ob_guard_approved_assignment_content();

notify pgrst, 'reload schema';
commit;
