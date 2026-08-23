-- One row per activated Mac. The license cap lives here: a purchase unlocks
-- at most N Macs at once (oldest gets bumped by the N+1th activation), which
-- is what turns "he forwarded my sign-in code" into a dead end.
create table if not exists public.installs (
  install_id text primary key,
  email      citext not null,
  user_id    uuid,
  revoked    boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists installs_email on public.installs (email, revoked, last_seen);
alter table public.installs enable row level security;
