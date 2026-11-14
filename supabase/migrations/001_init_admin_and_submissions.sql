-- Migration 001: admin access, inquiries (existing table), contact_messages.
-- Additive and non-destructive: no DROP TABLE, DELETE, TRUNCATE or data UPDATE.

-- 1. Admin allow-list (created only if missing)
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz not null default now()
);
insert into public.admins (email)
values ('shreeyashdiamondandjewelss@gmail.com')
on conflict (email) do nothing;

-- 2. Admin check used by every policy. SECURITY DEFINER lets it read admins even
-- though client roles have no access to that table.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- 3. EXISTING public.inquiries (id, name, phone, email, message, product_id,
-- product_name, gold_purity, created_at). Only missing columns are added.
-- New columns are nullable or have constant defaults, so existing rows are kept as is.
alter table public.inquiries add column if not exists idempotency_key uuid;
alter table public.inquiries add column if not exists kind text not null default 'price_enquiry';
alter table public.inquiries add column if not exists items jsonb;
alter table public.inquiries add column if not exists status text not null default 'new';

create unique index if not exists inquiries_idempotency_key_uidx on public.inquiries (idempotency_key);
create index if not exists inquiries_created_idx on public.inquiries (created_at desc);

-- NOT VALID: applies to new and updated rows only; existing rows are never checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inquiries_kind_check_v2') then
    alter table public.inquiries add constraint inquiries_kind_check_v2
      check (kind in ('price_enquiry', 'cart_lead')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inquiries_status_check_v2') then
    alter table public.inquiries add constraint inquiries_status_check_v2
      check (status in ('new', 'contacted', 'closed')) not valid;
  end if;
end $$;

-- 4. Contact page messages (created only if missing)
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid unique,
  name text not null,
  phone text not null,
  email text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'replied')),
  created_at timestamptz not null default now()
);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);

-- 5. Row Level Security. Anonymous users get no policy, so they cannot read or write.
-- Inserts come from Express via the service-role key (bypasses RLS).
alter table public.admins enable row level security;
alter table public.inquiries enable row level security;
alter table public.contact_messages enable row level security;

drop policy if exists admin_select on public.inquiries;
drop policy if exists admin_update on public.inquiries;
drop policy if exists admin_delete on public.inquiries;
create policy admin_select on public.inquiries for select to authenticated using (public.is_admin());
create policy admin_update on public.inquiries for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_delete on public.inquiries for delete to authenticated using (public.is_admin());

drop policy if exists admin_select on public.contact_messages;
drop policy if exists admin_update on public.contact_messages;
drop policy if exists admin_delete on public.contact_messages;
create policy admin_select on public.contact_messages for select to authenticated using (public.is_admin());
create policy admin_update on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_delete on public.contact_messages for delete to authenticated using (public.is_admin());

-- 6. Grants. Reset client roles, then allow select, delete and status-only updates.
-- service_role (Express) keeps its default access.
revoke all on public.admins, public.inquiries, public.contact_messages from anon, authenticated;
grant select, delete on public.inquiries, public.contact_messages to authenticated;
grant update (status) on public.inquiries, public.contact_messages to authenticated;
