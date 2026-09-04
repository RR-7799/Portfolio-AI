import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "upstox_batch_v1_2";
const BATCH_CONCURRENCY = 5;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing Supabase environment variables");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function uniqueById(items) {
  const map = new Map();
  for (const item of items || []) if (item?.id && !map.has(item.id)) map.set(item.id, item);
  return Array.from(map.values());
}

function isMutualFund(instrument) {
  const sector = String(instrument?.sector || "").trim().toUpperCase();
  return sector === "MUTUAL FUNDS & ETF" || sector.includes("MUTUAL FUND") || sector.includes("ETF");
}

async function syncSingleInstrument(baseUrl, isin) {
  const url = `${baseUrl}/api/sync-upstox-fundamentals?isin=${encodeURIComponent(isin)}`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { success: false, error: "Sync endpoint returned non-JSON response", raw_response: text.slice(0, 1000) }; }
    return {
      isin, http_status: response.status, duration_ms: Date.now() - startedAt,
      success: data?.success === true, engine_version: data?.engine_version || null,
      company_name: data?.instrument?.company_name || null, sector: data?.instrument?.sector || null,
      completeness: data?.sync?.completeness ?? null, provider: data?.provider || null,
      error: data?.error || null, step: data?.step || null, endpoint_status: data?.endpoint_status || null, data,
    };
  } catch (error) {
    return { isin, http_status: null, duration_ms: Date.now() - startedAt, success: false, engine_version: null,
      company_name: null, sector: null, completeness: null, provider: null, error: error?.message || "Unknown fetch error",
      step: "batch_fetch", endpoint_status: null, data: null };
  }
}

async function recordFundamentalSnapshot(supabase, instrumentId) {
  const { data: current, error: currentError } = await supabase
    .from("fundamentals")
    .select("instrument_id,sales_growth,profit_growth,roe,roce,debt_to_equity,operating_cash_flow,free_cash_flow,promoter_holding,promoter_pledge,fii_holding,dii_holding,market_cap,pe_ratio,pb_ratio,eps,book_value_per_share,financial_year,quarter,source")
    .eq("instrument_id", instrumentId)
    .maybeSingle();
  if (currentError) throw new Error(`History read failed: ${currentError.message}`);
  if (!current) return { recorded: false, reason: "No normalized fundamentals row" };

  const period = current.financial_year || current.quarter || null;
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  let existingQuery = supabase.from("fundamentals_history").select("id").eq("instrument_id", instrumentId).gte("snapshot_at", dayStart.toISOString()).limit(1);
  if (period) existingQuery = existingQuery.eq("period", period);
  const { data: existing, error: existingError } = await existingQuery;
  if (existingError) throw new Error(`History duplicate check failed: ${existingError.message}`);
  if (existing?.length) return { recorded: false, reason: "Snapshot already recorded today" };

  const { error: insertError } = await supabase.from("fundamentals_history").insert({
    instrument_id: current.instrument_id, period, snapshot_at: new Date().toISOString(),
    sales_growth: current.sales_growth, profit_growth: current.profit_growth, roe: current.roe, roce: current.roce,
    debt_to_equity: current.debt_to_equity, operating_cash_flow: current.operating_cash_flow, free_cash_flow: current.free_cash_flow,
    promoter_holding: current.promoter_holding, promoter_pledge: current.promoter_pledge, fii_holding: current.fii_holding,
    dii_holding: current.dii_holding, market_cap: current.market_cap, pe_ratio: current.pe_ratio, pb_ratio: current.pb_ratio,
    eps: current.eps, book_value_per_share: current.book_value_per_share, source: current.source || "upstox_normalized_snapshot"
  });
  if (insertError) throw new Error(`History insert failed: ${insertError.message}`);
  return { recorded: true, period };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length); let cursor = 0;
  async function runner() { while (true) { const index = cursor++; if (index >= items.length) return; results[index] = await worker(items[index], index); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
}

export async function GET(request) {
  const startedAt = Date.now();
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const requestedLimit = Number(searchParams.get("limit") || 5);
    const requestedOffset = Number(searchParams.get("offset") || 0);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 5, 1), 10);
    const offset = Math.max(Number.isFinite(requestedOffset) ? requestedOffset : 0, 0);
    const { data: instruments, error: instrumentsError } = await supabase.from("instruments").select("id,symbol,company_name,sector").order("company_name", { ascending: true });
    if (instrumentsError) throw new Error(`Failed to load instruments: ${instrumentsError.message}`);
    const uniqueInstruments = uniqueById(instruments);
    const stockInstruments = uniqueInstruments.filter(instrument => instrument?.symbol && !isMutualFund(instrument));
    const totalStocks = stockInstruments.length;
    const batch = stockInstruments.slice(offset, offset + limit);
    const baseUrl = new URL(request.url).origin;
    const results = await mapWithConcurrency(batch, BATCH_CONCURRENCY, async (instrument) => {
      const isin = String(instrument.symbol).trim().toUpperCase();
      const isIsin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);
      if (!isIsin) return { isin, company_name: instrument.company_name, sector: instrument.sector, success: false, skipped: true, error: "Instrument symbol is not a valid ISIN" };
      const result = await syncSingleInstrument(baseUrl, isin);
      let history = null;
      if (result.success) {
        try { history = await recordFundamentalSnapshot(supabase, instrument.id); }
        catch (error) { history = { recorded: false, error: error?.message || "History snapshot failed" }; }
      }
      return { ...result, instrument_id: instrument.id, expected_company_name: instrument.company_name, expected_sector: instrument.sector, history_snapshot: history };
    });
    const successful = results.filter(item => item.success === true);
    const failed = results.filter(item => item.success === false && item.skipped !== true);
    const skipped = results.filter(item => item.skipped === true);
    const historyRecorded = results.filter(item => item.history_snapshot?.recorded === true).length;
    const partial = successful.filter(item => item.completeness !== null && Number(item.completeness) < 100);
    const complete = successful.filter(item => item.completeness !== null && Number(item.completeness) >= 100);
    const nextOffset = offset + batch.length < totalStocks ? offset + batch.length : null;
    return Response.json({ success: true, engine_version: ENGINE_VERSION, batch: { offset, requested_limit: limit, returned: batch.length, total_stock_instruments: totalStocks, next_offset: nextOffset, finished: nextOffset === null }, summary: { successful: successful.length, failed: failed.length, skipped: skipped.length, complete_100: complete.length, partial_below_100: partial.length, history_snapshots_recorded: historyRecorded }, timing: { duration_ms: Date.now() - startedAt, concurrency: BATCH_CONCURRENCY }, results });
  } catch (error) {
    return Response.json({ success: false, engine_version: ENGINE_VERSION, step: "unexpected", error: error?.message || "Unknown error", duration_ms: Date.now() - startedAt }, { status: 500 });
  }
}
