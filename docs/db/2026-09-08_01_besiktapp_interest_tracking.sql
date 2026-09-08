-- Apply manually after review. This migration does not enable public tracking.
begin;
create table public.besiktapp_interest_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (request_key ~ '^[0-9a-f]{64}$'),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 1 and 254),
  company text not null default '' check (char_length(company) <= 160),
  phone text not null default '' check (char_length(phone) <= 40),
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'offered', 'activated', 'closed')),
  owner_name text not null default '' check (char_length(owner_name) <= 120),
  follow_up_on date,
  notification_state text not null default 'pending' check (notification_state in ('pending', 'accepted', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 0 check (revision >= 0)
);
create index besiktapp_interest_status_created on public.besiktapp_interest_requests(status, created_at desc, id);
alter table public.besiktapp_interest_requests enable row level security;
revoke all on public.besiktapp_interest_requests from public, anon, authenticated;
grant select, insert, update, delete on public.besiktapp_interest_requests to service_role;
-- No browser-accessible policies. All reads/writes go through authorized server code.
commit;
