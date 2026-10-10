-- Real-data finding: the legacy sheet reuses 20 Lead IDs across different companies. Never merge them.
create or replace function public.sync_apply_leads(p_run uuid, p_actor uuid, p_sheet text, p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_row int; v_company text; v_norm text; v_ext text; v_lead uuid; v_found_by text;
  v_n_ins int := 0; v_n_upd int := 0; v_n_skip int := 0; v_n_conf int := 0; v_n_rej int := 0;
  v_cands uuid[]; v_changed boolean; v_created boolean;
  v_emails text[]; v_phones text[]; v_links text[];
  v_temp text; v_stage text; v_legacy jsonb; v_old_legacy jsonb; v_name text;
  c jsonb; v_key text; v_ct contacts; v_new_emails text[]; v_new_phones text[]; v_new_links text[];
  v_fu date; v_fu_ins int; v_contacts_ins int := 0; v_dup_id text;
begin
  perform set_config('app.skip_audit', '1', true);
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);

  for r in select value from jsonb_array_elements(p_rows) loop
    v_row := (r ->> 'row_number')::int;
    v_company := btrim(coalesce(r ->> 'company', ''));
    v_ext := nullif(btrim(coalesce(r ->> 'external_lead_id', '')), '');
    v_norm := public.norm_name(v_company);
    v_created := false; v_changed := false; v_lead := null; v_found_by := null; v_dup_id := null;
    v_emails := coalesce(array(select jsonb_array_elements_text(r -> 'emails')), '{}');
    v_phones := coalesce(array(select jsonb_array_elements_text(r -> 'phones')), '{}');
    v_links  := coalesce(array(select jsonb_array_elements_text(r -> 'linkedin')), '{}');

    if v_company = '' then
      v_n_rej := v_n_rej + 1;
      perform sync_log_error(p_run, v_row, 'rejected', 'Missing company name', r);
      continue;
    end if;

    -- 1) external Lead ID
    if v_ext is not null then
      select id into v_lead from leads where external_lead_id = v_ext;
      if found then
        -- Same Lead ID but a DIFFERENT company (legacy sheets reuse ids): never merge. The row is imported as its own lead
        -- WITHOUT the clashing id (original kept in legacy.sheet_lead_id) and reported as a conflict.
        if exists (select 1 from leads where id = v_lead and name_norm <> v_norm
                    and not (source = 'google_sheet' and source_row = v_row)) then
          v_n_conf := v_n_conf + 1;
          perform sync_log_error(p_run, v_row, 'conflict', 'Lead ID ' || v_ext || ' is already used by a different company; imported as a separate lead without that id', r);
          v_lead := null; v_dup_id := v_ext; v_ext := null;
        else
          v_found_by := 'lead_id';
        end if;
      end if;
    end if;

    -- 2/3) strong Company + Email / Company + Phone (no Lead ID match)
    if v_lead is null then
      select array_agg(distinct l.id) into v_cands
        from leads l
       where l.name_norm = v_norm
         and (l.external_lead_id is null or v_ext is null or l.external_lead_id = v_ext)
         and exists (select 1 from contacts c2 where c2.lead_id = l.id
                      and (c2.emails && v_emails or c2.phones && v_phones));
      if coalesce(array_length(v_cands, 1), 0) = 1 then
        v_lead := v_cands[1]; v_found_by := 'company+contact';
      elsif coalesce(array_length(v_cands, 1), 0) > 1 then
        v_n_conf := v_n_conf + 1;
        perform sync_log_error(p_run, v_row, 'conflict', 'Several leads match this company + email/phone; not merged', r);
        continue;
      end if;
    end if;

    -- weak name-only evidence: only safe when it cannot be a different organisation
    if v_lead is null then
      select array_agg(l.id) into v_cands from leads l where l.name_norm = v_norm;
      if coalesce(array_length(v_cands, 1), 0) > 0 then
        if v_ext is null and array_length(v_cands, 1) = 1
           and (select source = 'google_sheet' and external_lead_id is null and not exists (select 1 from contacts c3 where c3.lead_id = leads.id and (cardinality(c3.emails) > 0 or cardinality(c3.phones) > 0))
                  from leads where id = v_cands[1])
           and cardinality(v_emails) = 0 and cardinality(v_phones) = 0 then
          v_lead := v_cands[1]; v_found_by := 'name-only(no identifiers)';
        else
          v_n_conf := v_n_conf + 1;
          perform sync_log_error(p_run, v_row, 'conflict',
            'Company name already exists but no Lead ID / email / phone confirms it is the same organisation; not merged', r);
          continue;
        end if;
      end if;
    end if;

    -- legacy values (kept for traceability; CRM-owned fields are not overwritten after first import)
    v_legacy := jsonb_strip_nulls(jsonb_build_object(
      'status', nullif(r ->> 'status', ''), 'next_step', nullif(r ->> 'next_step', ''),
      'notes', nullif(r ->> 'notes', ''), 'last_activity', nullif(r ->> 'last_activity', ''),
      'follow_up_date', nullif(r ->> 'follow_up_date', ''),
      'email_sent', r -> 'email_sent', 'contacted', r -> 'contacted', 'called', r -> 'called',
      'extra_notes', r -> 'extra_notes', 'sheet_lead_id', coalesce(v_dup_id, v_ext)));

    v_temp := case lower(coalesce(r ->> 'status', ''))
      when 'cold' then 'cold' when 'warm' then 'warm' when 'hot' then 'hot'
      when 'lost' then 'lost' when 'closed' then 'closed' else 'cold' end;
    v_stage := case when coalesce((r ->> 'email_sent')::boolean, false) or coalesce((r ->> 'contacted')::boolean, false)
                      or coalesce((r ->> 'called')::boolean, false) then 'outreach' else 'research' end;

    if v_lead is null then
      if not p_dry_run then
        insert into leads (name, external_lead_id, temperature, pipeline_stage, source, source_sheet, source_row, legacy, created_by)
        values (v_company, v_ext, v_temp, v_stage, 'google_sheet', p_sheet, v_row, v_legacy, p_actor)
        returning id into v_lead;
      end if;
      v_created := true;
    else
      select legacy, name into v_old_legacy, v_name from leads where id = v_lead;
      if v_old_legacy is distinct from v_legacy and not p_dry_run then
        update leads set legacy = v_legacy, source_row = v_row where id = v_lead;
        v_changed := true;
      elsif v_old_legacy is distinct from v_legacy then
        v_changed := true;
      end if;
    end if;

    -- contacts -----------------------------------------------------------------
    if not p_dry_run then
      -- general (company-level) contact carries every email / phone / LinkedIn URL from the row
      if cardinality(v_emails) + cardinality(v_phones) + cardinality(v_links) > 0 then
        select * into v_ct from contacts where lead_id = v_lead and dedupe_key = 'general';
        if not found then
          insert into contacts (lead_id, full_name, emails, phones, linkedin, dedupe_key, source)
          values (v_lead, '', v_emails, v_phones, v_links, 'general', 'google_sheet');
          v_contacts_ins := v_contacts_ins + 1; v_changed := true;
        else
          v_new_emails := public.array_union(v_ct.emails, v_emails);
          v_new_phones := public.array_union(v_ct.phones, v_phones);
          v_new_links := public.array_union(v_ct.linkedin, v_links);
          if v_new_emails <> v_ct.emails or v_new_phones <> v_ct.phones or v_new_links <> v_ct.linkedin then
            update contacts set emails = v_new_emails, phones = v_new_phones, linkedin = v_new_links where id = v_ct.id;
            v_changed := true;
          end if;
        end if;
      end if;
      -- named people
      for c in select value from jsonb_array_elements(coalesce(r -> 'contacts', '[]'::jsonb)) loop
        if btrim(coalesce(c ->> 'name', '')) = '' then continue; end if;
        v_key := 'n:' || public.norm_name(c ->> 'name');
        select * into v_ct from contacts where lead_id = v_lead and dedupe_key = v_key;
        if not found then
          insert into contacts (lead_id, full_name, job_title, dedupe_key, source, is_primary)
          values (v_lead, btrim(c ->> 'name'), nullif(btrim(coalesce(c ->> 'title', '')), ''), v_key, 'google_sheet',
                  not exists (select 1 from contacts where lead_id = v_lead and is_primary));
          v_contacts_ins := v_contacts_ins + 1; v_changed := true;
        elsif coalesce(v_ct.job_title, '') is distinct from coalesce(nullif(btrim(coalesce(c ->> 'title', '')), ''), v_ct.job_title, '') then
          update contacts set job_title = nullif(btrim(coalesce(c ->> 'title', '')), '') where id = v_ct.id;
          v_changed := true;
        end if;
      end loop;

      -- follow-up from the sheet date (never duplicated; never resurrects a completed one)
      v_fu := nullif(r ->> 'follow_up_date', '')::date;
      if v_fu is not null then
        insert into follow_ups (lead_id, owner_id, title, notes, due_date, origin, created_by)
        values (v_lead, (select owner_id from leads where id = v_lead), 'Follow-up (imported)',
                nullif(concat_ws(' · ', nullif(r ->> 'next_step', ''), nullif(r ->> 'notes', '')), ''), v_fu, 'google_sheet', p_actor)
        on conflict (lead_id, due_date) where origin = 'google_sheet' do nothing;
        get diagnostics v_fu_ins = row_count;
        if v_fu_ins > 0 then v_changed := true; end if;
      end if;
    end if;

    if v_created then v_n_ins := v_n_ins + 1;
    elsif v_changed then v_n_upd := v_n_upd + 1;
    else v_n_skip := v_n_skip + 1; end if;
  end loop;

  return jsonb_build_object('inserted', v_n_ins, 'updated', v_n_upd, 'skipped', v_n_skip,
                            'conflicts', v_n_conf, 'rejected', v_n_rej, 'contacts_inserted', v_contacts_ins);
end $$;
revoke all on function public.sync_apply_leads(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.sync_apply_leads(uuid, uuid, text, jsonb, boolean) to service_role;
