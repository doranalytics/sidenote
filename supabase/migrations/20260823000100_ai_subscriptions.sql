-- Two things are sold now: the app ($39 once) and AI ($10/month). Both are
-- rows in purchases, told apart by `kind`; the AI rows track the Stripe
-- subscription they came from.
alter table public.purchases
  add column if not exists kind text not null default 'app',          -- app | ai
  add column if not exists stripe_subscription_id text unique,
  add column if not exists current_period_end timestamptz;

-- status for kind='app':  paid | refunded
-- status for kind='ai':   active | trialing | past_due | canceled | unpaid | incomplete
create index if not exists purchases_email_kind on public.purchases (email, kind);
