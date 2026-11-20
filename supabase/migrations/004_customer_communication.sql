-- Apply after 003. Communication status is independent of admin and order status.
begin;

do $$
declare t text;
begin
  foreach t in array array['inquiries', 'orders', 'cart_leads'] loop
    execute format('alter table public.%I add column if not exists contact_status text not null default ''new''', t);
    execute format('alter table public.%I add column if not exists follow_up_date date', t);
    execute format('alter table public.%I add column if not exists last_contact_at timestamptz', t);
    execute format('alter table public.%I add column if not exists last_contact_method text', t);
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_contact_status_check') then
      execute format('alter table public.%I add constraint %I check (contact_status in (''new'', ''contacted'', ''follow-up'', ''closed''))', t, t || '_contact_status_check');
    end if;
    execute format('create index if not exists %I on public.%I (follow_up_date) where follow_up_date is not null', t || '_follow_up_date_idx', t);
  end loop;
end $$;

create table if not exists public.customer_contact_history (
  id bigint generated always as identity primary key,
  record_type text not null check (record_type in ('inquiries', 'orders', 'cart_leads')),
  record_id bigint not null,
  event_type text not null,
  detail text,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists customer_contact_history_record_idx
  on public.customer_contact_history (record_type, record_id, created_at desc, id desc);
alter table public.customer_contact_history enable row level security;
revoke all on public.customer_contact_history from public, anon, authenticated;
revoke all on sequence public.customer_contact_history_id_seq from public, anon, authenticated;
grant select, insert, delete on public.customer_contact_history to service_role;
grant usage, select on sequence public.customer_contact_history_id_seq to service_role;

-- A view allows a single, globally ordered, paginated follow-up list.
create or replace view public.admin_follow_ups as
  select 'inquiries'::text as record_type, follow_up_date, id, to_jsonb(i) as record from public.inquiries i where follow_up_date is not null
  union all
  select 'orders'::text, follow_up_date, id, to_jsonb(o) from public.orders o where follow_up_date is not null
  union all
  select 'cart_leads'::text, follow_up_date, id, to_jsonb(c) from public.cart_leads c where follow_up_date is not null;
revoke all on public.admin_follow_ups from public, anon, authenticated;
grant select on public.admin_follow_ups to service_role;

-- Updates and their audit events share a transaction and serialize on the record.
create or replace function public.admin_communication_action(
  p_table text, p_id bigint, p_actor uuid, p_action text, p_value text
) returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare old_status text; old_date date; event_detail text; event_name text;
begin
  if p_table not in ('inquiries', 'orders', 'cart_leads') or p_actor is null then
    raise exception 'Invalid communication target';
  end if;
  execute format('select contact_status, follow_up_date from public.%I where id = $1 for update', p_table)
    into old_status, old_date using p_id;
  if old_status is null then return false; end if;

  case p_action
    when 'status' then
      if p_value is null or p_value not in ('new', 'contacted', 'follow-up', 'closed') then raise exception 'Invalid status'; end if;
      if old_status = p_value then return true; end if;
      execute format('update public.%I set contact_status = $1 where id = $2', p_table) using p_value, p_id;
      event_name := 'status_changed'; event_detail := old_status || ' → ' || p_value;
    when 'schedule' then
      if p_value is null then raise exception 'Invalid follow-up date'; end if;
      execute format('update public.%I set follow_up_date = $1::date where id = $2', p_table) using p_value, p_id;
      event_name := 'follow_up_scheduled'; event_detail := p_value;
    when 'complete' then
      if old_date is null then raise exception 'No pending follow-up'; end if;
      execute format('update public.%I set follow_up_date = null where id = $1', p_table) using p_id;
      event_name := 'follow_up_completed'; event_detail := old_date::text;
    when 'note' then
      if p_value is null or length(trim(p_value)) = 0 or length(p_value) > 5000 then raise exception 'Invalid note'; end if;
      event_name := 'note_added'; event_detail := trim(p_value);
    when 'call_opened', 'whatsapp_opened', 'email_opened' then
      event_name := p_action; event_detail := null;
    when 'outcome' then
      if p_value is null or p_value !~ '^(call|whatsapp|email):.+' or length(p_value) > 5100 then raise exception 'Invalid outcome'; end if;
      execute format('update public.%I set last_contact_at = now(), last_contact_method = $1 where id = $2', p_table)
        using split_part(p_value, ':', 1), p_id;
      event_name := 'outcome_recorded'; event_detail := p_value;
    else raise exception 'Invalid communication action';
  end case;
  insert into public.customer_contact_history (record_type, record_id, event_type, detail, actor_id)
    values (p_table, p_id, event_name, event_detail, p_actor);
  return true;
end $$;
revoke all on function public.admin_communication_action(text, bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_communication_action(text, bigint, uuid, text, text) to service_role;

create or replace function public.delete_customer_contact_history() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  delete from public.customer_contact_history where record_type = tg_table_name and record_id = old.id;
  return old;
end $$;
revoke all on function public.delete_customer_contact_history() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['inquiries', 'orders', 'cart_leads'] loop
    execute format('drop trigger if exists delete_customer_contact_history on public.%I', t);
    execute format('create trigger delete_customer_contact_history after delete on public.%I for each row execute function public.delete_customer_contact_history()', t);
  end loop;
end $$;
commit;
