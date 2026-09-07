begin;

create table if not exists public.renoapp_consultant_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.renovation_cases(id) on delete restrict,
  brf_id uuid not null references public.brf_associations(id) on delete restrict,
  requester_profile_id uuid not null references public.profiles(id) on delete restrict,
  requester_name text not null,
  requester_email text not null,
  message text check (length(message) <= 4000),
  price_ore integer not null default 150000 check (price_ore = 150000),
  currency text not null default 'SEK' check (currency = 'SEK'),
  price_excludes_vat boolean not null default true check (price_excludes_vat),
  created_at timestamptz not null default clock_timestamp(),
  email_payload jsonb not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  delivery_attempt_id uuid,
  delivery_attempt_at timestamptz,
  provider_message_id text
);

alter table public.renoapp_consultant_reviews enable row level security;
revoke all on public.renoapp_consultant_reviews from public, anon, authenticated;
grant select, insert, update on public.renoapp_consultant_reviews to service_role;

-- An order is immutable; only its notification delivery can change.
create or replace function public.renoapp_guard_consultant_review()
returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - array['delivery_status','delivery_attempt_id','delivery_attempt_at','provider_message_id'])
    is distinct from (to_jsonb(old) - array['delivery_status','delivery_attempt_id','delivery_attempt_at','provider_message_id']) then
    raise exception 'REVIEW_ORDER_IMMUTABLE';
  end if;
  return new;
end;
$$;
drop trigger if exists renoapp_guard_consultant_review on public.renoapp_consultant_reviews;
create trigger renoapp_guard_consultant_review before update on public.renoapp_consultant_reviews
for each row execute function public.renoapp_guard_consultant_review();

create or replace function public.renoapp_order_consultant_review(
  p_case_id uuid, p_actor uuid, p_name text, p_email text, p_message text, p_email_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.renovation_cases; r public.renoapp_consultant_reviews;
begin
  select * into c from public.renovation_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  select * into r from public.renoapp_consultant_reviews where case_id = p_case_id;
  if found then return to_jsonb(r); end if;
  if c.status = 'draft' then raise exception 'REVIEW_DRAFT'; end if;
  insert into public.renoapp_consultant_reviews(case_id,brf_id,requester_profile_id,requester_name,requester_email,message,email_payload)
    values(c.id,c.brf_id,p_actor,p_name,p_email,nullif(btrim(p_message),''),p_email_payload)
    returning * into r;
  return to_jsonb(r);
end;
$$;

-- Lease plus provider idempotency prevents parallel retries from sending twice.
create or replace function public.renoapp_claim_review_email(p_id uuid, p_attempt uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.renoapp_consultant_reviews set delivery_status = 'pending',
    delivery_attempt_id = p_attempt, delivery_attempt_at = clock_timestamp()
    where id = p_id and delivery_status <> 'sent'
    and (delivery_attempt_at is null or delivery_attempt_at < clock_timestamp() - interval '2 minutes');
  return found;
end;
$$;

revoke all on function public.renoapp_order_consultant_review(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.renoapp_claim_review_email(uuid,uuid) from public, anon, authenticated;
grant execute on function public.renoapp_order_consultant_review(uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.renoapp_claim_review_email(uuid,uuid) to service_role;

commit;
