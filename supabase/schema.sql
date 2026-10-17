-- JUBA admin schema. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per app install. The app creates the id (a random UUID) on first
-- launch, so no sign-up is needed.
create table if not exists public.devices (
  id uuid primary key,
  platform text,
  app_version text,
  language text,
  region text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  launches integer not null default 1,
  ads_disabled boolean not null default false,
  note text
);

create index if not exists devices_last_seen_idx on public.devices (last_seen_at desc);

-- Tips bought through Google Play Billing.
create table if not exists public.tips (
  id bigint generated always as identity primary key,
  device_id uuid references public.devices (id) on delete set null,
  product_id text not null,
  order_id text unique,
  price numeric,
  currency text,
  display_price text,
  created_at timestamptz not null default now()
);

create index if not exists tips_device_idx on public.tips (device_id);
create index if not exists tips_created_idx on public.tips (created_at desc);

-- Supabase Auth users allowed into the admin panel.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Row level security: the anon key (shipped inside the app) cannot read or
-- write any table directly. The app only calls the two functions below.
-- ---------------------------------------------------------------------------

alter table public.devices enable row level security;
alter table public.tips enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admins read devices" on public.devices;
create policy "admins read devices" on public.devices
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update devices" on public.devices;
create policy "admins update devices" on public.devices
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read tips" on public.tips;
create policy "admins read tips" on public.tips
  for select to authenticated using (public.is_admin());

drop policy if exists "admins delete tips" on public.tips;
create policy "admins delete tips" on public.tips
  for delete to authenticated using (public.is_admin());

drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Devices with their tip totals, for the admin panel. security_invoker makes
-- the view respect the RLS policies above.
create or replace view public.device_overview
with (security_invoker = true) as
select
  d.*,
  d.id::text as id_text,
  count(t.id)::int as tips_count,
  max(t.created_at) as last_tip_at
from public.devices d
left join public.tips t on t.device_id = d.id
group by d.id;

-- ---------------------------------------------------------------------------
-- Functions the app calls with the anon key
-- ---------------------------------------------------------------------------

-- Called on launch, when the app returns to the foreground, and every few
-- minutes while it is open. Returns whether ads are disabled for the device.
create or replace function public.register_device(
  p_device_id uuid,
  p_platform text default null,
  p_app_version text default null,
  p_language text default null,
  p_region text default null,
  p_launch boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ads_disabled boolean;
begin
  insert into public.devices (id, platform, app_version, language, region)
  values (
    p_device_id,
    left(p_platform, 20),
    left(p_app_version, 20),
    left(p_language, 10),
    left(p_region, 10)
  )
  on conflict (id) do update set
    platform = coalesce(excluded.platform, devices.platform),
    app_version = coalesce(excluded.app_version, devices.app_version),
    language = coalesce(excluded.language, devices.language),
    region = coalesce(excluded.region, devices.region),
    last_seen_at = now(),
    launches = devices.launches + case when p_launch then 1 else 0 end
  returning ads_disabled into v_ads_disabled;
  return v_ads_disabled;
end;
$$;

-- Called after a tip purchase. order_id is unique, so a retry is harmless.
create or replace function public.record_tip(
  p_device_id uuid,
  p_product_id text,
  p_order_id text,
  p_price numeric default null,
  p_currency text default null,
  p_display_price text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.devices (id) values (p_device_id) on conflict (id) do nothing;
  insert into public.tips (device_id, product_id, order_id, price, currency, display_price)
  values (
    p_device_id,
    left(p_product_id, 100),
    left(p_order_id, 200),
    p_price,
    left(p_currency, 10),
    left(p_display_price, 30)
  )
  on conflict (order_id) do nothing;
end;
$$;

-- Dashboard numbers. Admins only.
create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  return json_build_object(
    'devices', (select count(*) from devices),
    'online', (select count(*) from devices where last_seen_at > now() - interval '5 minutes'),
    'active_today', (select count(*) from devices where last_seen_at > now() - interval '24 hours'),
    'active_week', (select count(*) from devices where last_seen_at > now() - interval '7 days'),
    'new_week', (select count(*) from devices where created_at > now() - interval '7 days'),
    'ads_disabled', (select count(*) from devices where ads_disabled),
    'tips', (select count(*) from tips),
    'tip_totals', (
      select coalesce(json_agg(json_build_object('currency', currency, 'total', total)), '[]'::json)
      from (
        select coalesce(currency, '?') as currency, sum(price) as total
        from tips group by 1 order by 2 desc
      ) s
    )
  );
end;
$$;

revoke all on function public.register_device(uuid, text, text, text, text, boolean) from public;
revoke all on function public.record_tip(uuid, text, text, numeric, text, text) from public;
revoke all on function public.admin_stats() from public;
grant execute on function public.register_device(uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.record_tip(uuid, text, text, numeric, text, text) to anon, authenticated;
grant execute on function public.admin_stats() to authenticated;
