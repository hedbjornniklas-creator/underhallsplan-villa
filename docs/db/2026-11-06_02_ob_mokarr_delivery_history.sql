-- Controlled repair of the three send records identified during the Mokarr investigation.
-- No email is sent. No report snapshot, PDF, token or version binding is changed.
-- The original message identifiers are authoritative; there is no email/time-based bulk matching.
begin;
do $$
declare
  v_inspection uuid := 'e9b31370-39b8-4ee2-ac06-3bdecb80f96d';
  v_org uuid := '71c056a9-aef5-42ce-872c-75952bc55795';
  v_messages uuid[] := array[
    '8ea0a501-50dc-4bdb-82a2-ef7bccfaeb63'::uuid,
    '176821a9-2fc0-416e-b694-7318436f06f9'::uuid,
    '7431b736-c656-416b-b7e5-cce42b4e1986'::uuid
  ];
begin
  if not exists (select 1 from public.ob_organization_bindings b join public.inspections i on i.id = b.inspection_id
    where b.inspection_id = v_inspection and b.org_id = v_org
      and i.property_id = '7361a788-24e6-41b9-91f5-081c04c116f3'::uuid) then
    raise exception 'OB_LEGACY_HISTORY_REPAIR_BINDING_MISMATCH';
  end if;
  if (select count(*) from public.outbound_messages m where m.id = any(v_messages) and m.org_id = v_org
    and m.template_key = 'inspection_report_delivery' and m.provider = 'resend' and m.status = 'sent'
    and (m.inspection_id is null or m.inspection_id = v_inspection)) <> 3 then
    raise exception 'OB_LEGACY_HISTORY_REPAIR_RECORD_MISMATCH';
  end if;
  update public.outbound_messages set inspection_id = v_inspection
    where id = any(v_messages) and org_id = v_org and inspection_id is null;
  -- The old mail records do not store an exact report FK. Do not invent one.
end $$;
commit;
