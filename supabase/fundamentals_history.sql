-- V5.4 historical fundamentals capture
-- Applied to production Supabase before this file was committed.

alter table public.fundamentals_history
  add constraint fundamentals_history_instrument_period_key unique (instrument_id, period);

create or replace function public.capture_fundamentals_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.financial_year is null then
    return new;
  end if;

  insert into public.fundamentals_history (
    instrument_id, period, snapshot_at,
    sales_growth, profit_growth, roe, roce,
    debt_to_equity, operating_cash_flow, free_cash_flow,
    promoter_holding, promoter_pledge, fii_holding, dii_holding,
    market_cap, pe_ratio, pb_ratio, eps, book_value_per_share, source
  ) values (
    new.instrument_id, new.financial_year, now(),
    new.sales_growth, new.profit_growth, new.roe, new.roce,
    new.debt_to_equity, new.operating_cash_flow, new.free_cash_flow,
    new.promoter_holding, new.promoter_pledge, new.fii_holding, new.dii_holding,
    new.market_cap, new.pe_ratio, new.pb_ratio, new.eps, new.book_value_per_share,
    coalesce(new.source, 'Upstox')
  )
  on conflict (instrument_id, period) do update set
    snapshot_at = excluded.snapshot_at,
    sales_growth = excluded.sales_growth,
    profit_growth = excluded.profit_growth,
    roe = excluded.roe,
    roce = excluded.roce,
    debt_to_equity = excluded.debt_to_equity,
    operating_cash_flow = excluded.operating_cash_flow,
    free_cash_flow = excluded.free_cash_flow,
    promoter_holding = excluded.promoter_holding,
    promoter_pledge = excluded.promoter_pledge,
    fii_holding = excluded.fii_holding,
    dii_holding = excluded.dii_holding,
    market_cap = excluded.market_cap,
    pe_ratio = excluded.pe_ratio,
    pb_ratio = excluded.pb_ratio,
    eps = excluded.eps,
    book_value_per_share = excluded.book_value_per_share,
    source = excluded.source;

  return new;
end;
$$;

drop trigger if exists fundamentals_history_capture on public.fundamentals;
create trigger fundamentals_history_capture
after insert or update on public.fundamentals
for each row execute function public.capture_fundamentals_history();
