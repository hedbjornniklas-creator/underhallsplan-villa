-- Fix SQLSTATE 42702 during paid follow-up activation.
-- Apply after 2026-09-08_06_eb_follow_up_acceptance.sql.
-- eb_notes.source_note_id is a real column: keep the local variable distinct
-- and qualify table columns. No order, report, consent or mail data is changed.
begin;

create or replace function public.eb_complete_follow_up_order(
  p_challenge_id uuid,p_report_link_id uuid,p_candidate_order_id uuid,p_project_id uuid,
  p_buyer jsonb,p_seller jsonb,p_tasks jsonb,p_access jsonb,p_emails jsonb,p_create boolean,p_terms_version text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c eb_follow_up_challenges; r inspection_report_links; o eb_follow_up_orders;
  task jsonb; mail jsonb; task_id uuid; created boolean := false; v_source_note_id uuid;
begin
  select * into c from eb_follow_up_challenges where id=p_challenge_id and report_link_id=p_report_link_id for update;
  if not found or not c.eligible or c.verified_at is null or c.expires_at <= now() then
    raise exception 'EB_FOLLOW_UP_VERIFICATION_REQUIRED'; end if;
  if c.completed_order_id is not null then
    return jsonb_build_object('orderId',c.completed_order_id,'encryptedResult',c.encrypted_result,'created',false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eb-follow-up-order:'||c.inspection_id::text,0));
  select * into r from inspection_report_links where id=p_report_link_id and org_id=c.org_id and revoked_at is null for share;
  if not found then raise exception 'EB_FOLLOW_UP_REPORT_UNAVAILABLE'; end if;
  select * into o from eb_follow_up_orders where inspection_id=c.inspection_id for update;
  if not found then
    if not p_create then raise exception 'EB_FOLLOW_UP_ORDER_REQUIRED'; end if;
    if exists(select 1 from inspection_report_links where inspection_id=c.inspection_id and org_id=c.org_id
      and revoked_at is null and (created_at,id) > (r.created_at,r.id)) then
      raise exception 'EB_FOLLOW_UP_REPORT_REPLACED'; end if;
    if p_terms_version is distinct from '2026-09-08.2' or p_buyer->>'email' <> c.email then
      raise exception 'EB_FOLLOW_UP_CONSENT_REQUIRED'; end if;
    if not exists(select 1 from eb_projects where id=p_project_id and org_id=c.org_id) then
      raise exception 'EB_FOLLOW_UP_REPORT_UNAVAILABLE'; end if;
    insert into eb_follow_up_orders(id,org_id,eb_project_id,inspection_id,report_link_id,report_snapshot,
      buyer_snapshot,seller_snapshot,terms_version,accept_terms,request_immediate_start,accept_invoice)
      values(p_candidate_order_id,c.org_id,p_project_id,c.inspection_id,r.id,r.snapshot_payload,
        p_buyer,p_seller,p_terms_version,true,true,true) returning * into o;
    created := true;
    for task in select value from jsonb_array_elements(p_tasks) loop
      v_source_note_id := (task->>'noteId')::uuid;
      insert into eb_remediation_tasks(org_id,eb_project_id,inspection_id,eb_note_id,original_note_id,
        follow_up_order_id,assignment_managed_by,note_snapshot,original_images)
        values(c.org_id,p_project_id,c.inspection_id,
          (select source_note.id from eb_notes as source_note where source_note.id=v_source_note_id and source_note.inspection_id=c.inspection_id),v_source_note_id,
          o.id,'contractor',task->'snapshot',coalesce(task->'images','[]'::jsonb)) returning id into task_id;
      insert into eb_remediation_events(org_id,eb_project_id,task_id,event_type,actor_name,actor_email,metadata)
        values(c.org_id,p_project_id,task_id,'task_created',p_buyer->>'name',c.email,
          jsonb_build_object('followUpOrderId',o.id,'reportLinkId',r.id));
    end loop;
  elsif lower(o.buyer_snapshot->>'email') <> c.email then
    raise exception 'EB_FOLLOW_UP_BUYER_MISMATCH';
  end if;
  insert into eb_remediation_access_links(id,org_id,eb_project_id,inspection_id,follow_up_order_id,
    role,display_name,email,token_hash,expires_at)
    values((p_access->>'id')::uuid,o.org_id,o.eb_project_id,o.inspection_id,o.id,'customer_owner',
      o.buyer_snapshot->>'name',c.email,p_access->>'tokenHash',(p_access->>'expiresAt')::timestamptz);
  for mail in select value from jsonb_array_elements(p_emails) loop
    if (created and mail->>'kind' in ('receipt','invoice')) or (not created and mail->>'kind'='access') then
      insert into eb_follow_up_email_outbox(order_id,dedupe_key,kind,payload_ciphertext)
        values(o.id,mail->>'dedupeKey',mail->>'kind',mail->>'ciphertext') on conflict(dedupe_key) do nothing;
    end if;
  end loop;
  update eb_follow_up_challenges set completed_order_id=o.id,encrypted_result=p_access->>'encryptedResult' where id=c.id;
  return jsonb_build_object('orderId',o.id,'encryptedResult',p_access->>'encryptedResult','created',created);
end $$;

revoke all on function public.eb_complete_follow_up_order(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.eb_complete_follow_up_order(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,text) to service_role;

commit;
