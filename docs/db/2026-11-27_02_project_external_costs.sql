-- Permit a combined running charge based only on documented external costs.
-- No data migration: existing terms, calculations and frozen documents stay intact.
begin;

create or replace function public.assert_project_customer_price(t jsonb, complete boolean default false)
returns void language plpgsql set search_path=public,pg_catalog as $$
declare c jsonb; k text; n numeric; p record;
begin
  if jsonb_typeof(t) is distinct from 'object' or t->'version' is distinct from '1'::jsonb
    or coalesce(t->>'split','') not in ('combined','separate') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  foreach k in array array['assumptions','reviewTerms'] loop
    if jsonb_typeof(t->k) is distinct from 'string' or length(t->>k)>6000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  for c in select t->key from unnest(array['combined','labour','material']) key loop
    if jsonb_typeof(c) is distinct from 'object' or coalesce(c->>'mode','') not in ('fixed','running','budget') then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
    foreach k in array array['fixedOre','budgetOre','hourlyOre','markupPercent'] loop
      if not c ? k then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      if c->k<>'null'::jsonb then
        if jsonb_typeof(c->k) is distinct from 'number' then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
        n:=(c->>k)::numeric;
        if n<0 or (k='markupPercent' and (n>1000 or n*100<>trunc(n*100)))
          or (k<>'markupPercent' and (n>100000000000 or n<>trunc(n))) then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
      end if;
    end loop;
  end loop;
  foreach k in array array['fixedOre','budgetOre'] loop
    if (select sum(coalesce((charge->>k)::numeric,0)) from public.customer_price_parts(t))>100000000000 then raise exception 'CUSTOMER_OFFER_INVALID'; end if;
  end loop;
  if complete then
    for p in select * from public.customer_price_parts(t) loop
      c:=p.charge;
      if (c->>'mode'='fixed' and c->'fixedOre'='null'::jsonb)
        or (c->>'mode'<>'fixed' and (p.part='labour' or (p.part='combined' and c->'hourlyOre'<>'null'::jsonb)) and coalesce((c->>'hourlyOre')::bigint,0)<=0)
        or (c->>'mode'<>'fixed' and p.part<>'labour' and c->'markupPercent'='null'::jsonb)
        or (c->>'mode'='budget' and (c->'budgetOre'='null'::jsonb or nullif(btrim(t->>'assumptions'),'') is null or nullif(btrim(t->>'reviewTerms'),'') is null))
        then raise exception 'CUSTOMER_OFFER_INCOMPLETE'; end if;
    end loop;
  end if;
end $$;

revoke all on function public.assert_project_customer_price(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.assert_project_customer_price(jsonb,boolean) to service_role;
commit;
