-- Apply once after inspecting the current project. This migration does not run
-- migrations 001 or 002 and does not change order fulfilment status.
begin;

alter table public.inquiries add column if not exists admin_status text not null default 'new';
alter table public.orders add column if not exists admin_status text not null default 'new';
alter table public.cart_leads add column if not exists admin_status text not null default 'new';

do $$
declare
  target_table text;
  constraint_name text;
  column_names text;
begin
  foreach target_table in array array['inquiries', 'orders', 'cart_leads'] loop
    constraint_name := target_table || '_admin_status_check';
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', target_table)::regclass
        and conname = constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (admin_status in (''new'', ''read'', ''replied''))',
        target_table, constraint_name
      );
    end if;
    execute format('alter table public.%I enable row level security', target_table);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', target_table);
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into column_names from information_schema.columns
      where table_schema = 'public' and columns.table_name = target_table;
    execute format('revoke all privileges (%s) on table public.%I from public, anon, authenticated', column_names, target_table);
  end loop;
end $$;

commit;
