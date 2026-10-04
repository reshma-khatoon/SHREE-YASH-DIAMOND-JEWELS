create extension if not exists pgcrypto;

create table if not exists public.visitor_sessions (
  session_id uuid primary key,
  first_page text not null,
  device text not null default '',
  referrer text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.visitor_pageviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.visitor_sessions(session_id) on delete cascade,
  page_path text not null,
  device text not null default '',
  referrer text not null default '',
  visited_at timestamptz not null default now()
);

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  message text,
  product_id text,
  product_name text,
  gold_purity text check (gold_purity in ('14K', '18K', '22K')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  order_id text primary key,
  idempotency_key uuid not null unique,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  delivery_address text not null,
  items jsonb not null,
  total_amount text not null default 'To be confirmed (Price on Request)',
  created_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  event_type text not null check (event_type in ('visitor', 'inquiry', 'order')),
  event_id text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  error_code text,
  updated_at timestamptz not null default now(),
  primary key (event_type, event_id, channel)
);

create table if not exists public.api_rate_limits (
  key_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0,
  primary key (key_hash, bucket_start)
);

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_bucket_start timestamptz,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  if random() < 0.01 then
    delete from public.api_rate_limits where bucket_start < now() - interval '2 days';
  end if;

  insert into public.api_rate_limits (key_hash, bucket_start, request_count)
  values (p_key_hash, p_bucket_start, 1)
  on conflict (key_hash, bucket_start)
  do update set request_count = api_rate_limits.request_count + 1
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

alter table public.visitor_sessions enable row level security;
alter table public.visitor_pageviews enable row level security;
alter table public.inquiries enable row level security;
alter table public.orders enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.api_rate_limits enable row level security;

revoke all on public.visitor_sessions, public.visitor_pageviews, public.inquiries, public.orders,
  public.notification_deliveries, public.api_rate_limits from anon, authenticated;
revoke all on function public.consume_rate_limit(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, timestamptz, integer) to service_role;