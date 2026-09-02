create table if not exists public.copilot_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  question text not null,
  answer text not null,
  market_regime text,
  portfolio_value numeric,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists copilot_memory_user_time_idx
  on public.copilot_memory(user_id, created_at desc);

alter table public.copilot_memory enable row level security;

drop policy if exists "Users can read own copilot memory" on public.copilot_memory;
create policy "Users can read own copilot memory"
  on public.copilot_memory for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own copilot memory" on public.copilot_memory;
create policy "Users can insert own copilot memory"
  on public.copilot_memory for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own copilot memory" on public.copilot_memory;
create policy "Users can delete own copilot memory"
  on public.copilot_memory for delete
  using (auth.uid() = user_id);
