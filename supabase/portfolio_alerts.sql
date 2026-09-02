-- Portfolio AI: persistent alert history
-- Run this once in Supabase SQL Editor.

create table if not exists public.portfolio_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instrument_id uuid null references public.instruments(id) on delete set null,
  severity text not null check (severity in ('CRITICAL','WARNING','INFO')),
  type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  dedupe_key text,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_alerts_user_created_idx
  on public.portfolio_alerts(user_id, created_at desc);

create index if not exists portfolio_alerts_user_read_idx
  on public.portfolio_alerts(user_id, is_read);

create unique index if not exists portfolio_alerts_dedupe_idx
  on public.portfolio_alerts(user_id, dedupe_key)
  where dedupe_key is not null;

alter table public.portfolio_alerts enable row level security;

drop policy if exists "Users can read own portfolio alerts" on public.portfolio_alerts;
create policy "Users can read own portfolio alerts"
  on public.portfolio_alerts for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own portfolio alerts" on public.portfolio_alerts;
create policy "Users can insert own portfolio alerts"
  on public.portfolio_alerts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own portfolio alerts" on public.portfolio_alerts;
create policy "Users can update own portfolio alerts"
  on public.portfolio_alerts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own portfolio alerts" on public.portfolio_alerts;
create policy "Users can delete own portfolio alerts"
  on public.portfolio_alerts for delete
  using (auth.uid() = user_id);
