create table if not exists public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  total_value numeric not null default 0,
  invested_value numeric not null default 0,
  unrealized_pnl numeric not null default 0,
  pnl_pct numeric not null default 0,
  stock_value numeric not null default 0,
  mf_value numeric not null default 0,
  stock_count integer not null default 0,
  mf_count integer not null default 0,
  average_ai_score numeric,
  health_score numeric,
  high_risk_capital_pct numeric not null default 0,
  weak_score_capital_pct numeric not null default 0,
  bull_neutral_bear text,
  portfolio_mode text,
  summary jsonb not null default '{}'::jsonb
);

create index if not exists portfolio_snapshots_user_time_idx
  on public.portfolio_snapshots(user_id, snapshot_at desc);

alter table public.portfolio_snapshots enable row level security;

drop policy if exists "Users can read own portfolio snapshots" on public.portfolio_snapshots;
create policy "Users can read own portfolio snapshots"
  on public.portfolio_snapshots for select
  using (auth.uid() = user_id);

create table if not exists public.market_regime_history (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  regime text not null,
  score numeric not null default 0,
  confidence numeric not null default 0,
  portfolio_mode text,
  buy_multiplier numeric,
  position_target_multiplier numeric,
  indicators jsonb not null default '{}'::jsonb
);

create index if not exists market_regime_history_time_idx
  on public.market_regime_history(snapshot_at desc);

alter table public.market_regime_history enable row level security;

drop policy if exists "Authenticated users can read regime history" on public.market_regime_history;
create policy "Authenticated users can read regime history"
  on public.market_regime_history for select
  to authenticated
  using (true);
