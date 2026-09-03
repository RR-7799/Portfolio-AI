-- Portfolio AI scorer v5 migration
-- Backward compatible: preserves total_score and existing ai_scores rows.

alter table public.ai_scores add column if not exists long_term_score numeric;
alter table public.ai_scores add column if not exists short_term_score numeric;
alter table public.ai_scores add column if not exists final_ai_score numeric;
alter table public.ai_scores add column if not exists confidence numeric;
alter table public.ai_scores add column if not exists data_completeness numeric;
alter table public.ai_scores add column if not exists freshness_status text;
alter table public.ai_scores add column if not exists score_version text;
alter table public.ai_scores add column if not exists calculation_metadata jsonb;

-- Keep existing score_breakdown as the detailed JSONB container.
-- Existing total_score remains as a compatibility alias populated by scorer v5.
create index if not exists ai_scores_score_version_idx on public.ai_scores(score_version);
create index if not exists ai_scores_final_ai_score_idx on public.ai_scores(final_ai_score);
