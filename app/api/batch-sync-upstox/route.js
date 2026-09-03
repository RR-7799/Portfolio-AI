import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "upstox_batch_v1_1";
const BATCH_CONCURRENCY = 5;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) throw new Error("Missing Supabase environment variables");

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: false, error: "Sync endpoint returned non-JSON response", raw_response: text.slice(0, 1000) };
    }

    return {
      isin,
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
      success: data?.success === true,
      engine_version: data?.engine_version || null,
      company_name: data?.instrument?.company_name || null,
      sector: data?.instrument?.sector || null,
      completeness: data?.sync?.completeness ?? null,
      provider: data?.provider || null,
      error: data?.error || null,
      step: data?.step || null,
      endpoint_status: data?.endpoint_status || null,
      data,
    };
  } catch (error) {
    return {
      isin,
      http_status: null,
      duration_ms: Date.now() - startedAt,
      success: false,
      engine_version: null,
      company_name: null,
      sector: null,
      completeness: null,
      provider: null,
      error: error?.message || "Unknown fetch error",
      step: "batch_fetch",
      endpoint_status: null,
      data: null,
    };
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
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

    const { data: instruments, error: instrumentsError } = await supabase
      .from("instruments")
      .select("id,symbol,company_name,sector")
      .order("company_name", { ascending: true });
    if (instrumentsError) throw new Error(`Failed to load instruments: ${instrumentsError.message}`);

    const uniqueInstruments = uniqueById(instruments);
    const stockInstruments = uniqueInstruments.filter(instrument => instrument?.symbol && !isMutualFund(instrument));
    const totalStocks = stockInstruments.length;
    const batch = stockInstruments.slice(offset, offset + limit);
    const baseUrl = new URL(request.url).origin;

    // Run up to five Upstox sync requests concurrently instead of serially.
    // This keeps the batch engine fast while avoiding an aggressive burst of requests.
    const results = await mapWithConcurrency(batch, BATCH_CONCURRENCY, async (instrument) => {
      const isin = String(instrument.symbol).trim().toUpperCase();
      const isIsin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);

      if (!isIsin) {
        return {
          isin,
          company_name: instrument.company_name,
          sector: instrument.sector,
          success: false,
          skipped: true,
          error: "Instrument symbol is not a valid ISIN",
        };
      }

      const result = await syncSingleInstrument(baseUrl, isin);
      return {
        ...result,
        instrument_id: instrument.id,
        expected_company_name: instrument.company_name,
        expected_sector: instrument.sector,
      };
    });

    const successful = results.filter(item => item.success === true);
    const failed = results.filter(item => item.success === false && item.skipped !== true);
    const skipped = results.filter(item => item.skipped === true);
    const partial = successful.filter(item => item.completeness !== null && Number(item.completeness) < 100);
    const complete = successful.filter(item => item.completeness !== null && Number(item.completeness) >= 100);
    const nextOffset = offset + batch.length < totalStocks ? offset + batch.length : null;

    return Response.json({
      success: true,
      engine_version: ENGINE_VERSION,
      batch: {
        offset,
        requested_limit: limit,
        returned: batch.length,
        total_stock_instruments: totalStocks,
        next_offset: nextOffset,
        finished: nextOffset === null,
      },
      summary: {
        successful: successful.length,
        failed: failed.length,
        skipped: skipped.length,
        complete_100: complete.length,
        partial_below_100: partial.length,
      },
      timing: {
        duration_ms: Date.now() - startedAt,
        concurrency: BATCH_CONCURRENCY,
      },
      results,
    });
  } catch (error) {
    return Response.json({
      success: false,
      engine_version: ENGINE_VERSION,
      step: "unexpected",
      error: error?.message || "Unknown error",
      duration_ms: Date.now() - startedAt,
    }, { status: 500 });
  }
}
