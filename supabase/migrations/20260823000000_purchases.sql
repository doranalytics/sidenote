-- Purchases and the private release store for the $39 paywall.
--
-- No RLS policies on purpose: nothing in the browser or the app ever talks to
-- these tables. sidenote.lol's server routes use the service role; the anon
-- key is only used for Auth (sending and verifying sign-in codes).
create extension if not exists citext;

create table if not exists public.purchases (
  id                         uuid primary key default gen_random_uuid(),
  email                      citext not null,
  user_id                    uuid references auth.users(id) on delete set null,
  source                     text not null default 'stripe',   -- stripe | manual
  livemode                   boolean not null default true,
  status                     text not null default 'paid',     -- paid | refunded
  stripe_customer_id         text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  amount_cents               integer not null default 0,
  currency                   text not null default 'usd',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index if not exists purchases_email on public.purchases (email);
create index if not exists purchases_user_id on public.purchases (user_id);
alter table public.purchases enable row level security;

-- Every time a build is handed out, and which door it came through.
create table if not exists public.downloads (
  id         bigserial primary key,
  email      citext,
  file       text not null,
  via        text not null,   -- thanks | signin | update
  created_at timestamptz not null default now()
);
alter table public.downloads enable row level security;

-- The DMG and the updater's zip live here, private; sidenote.lol hands out
-- 60-second signed URLs to people who have paid.
insert into storage.buckets (id, name, public)
values ('releases', 'releases', false)
on conflict (id) do nothing;
