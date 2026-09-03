import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "market_quotes_v1_1";
const UPSTOX_URL = "https://api.upstox.com/v3/market-quote/ltp";

function userClient(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function isNseEquityIsin(value) {
  return /^INE[A-Z0-9]{9,12}$/i.test(String(value || "").trim());
}

function instrumentKey(instrument) {
  const rawKey = String(instrument?.instrument_key || "").trim();
  if (rawKey.includes("|")) return rawKey;

  const symbol = String(instrument?.symbol || "").trim();
  if (symbol.includes("|")) return symbol;
  if (isNseEquityIsin(symbol)) return `NSE_EQ|${symbol}`;

  return null;
}

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return NextResponse.json(
        { success: false, engine_version: ENGINE_VERSION, error: "Authentication required." },
        { status: 401 }
      );
    }

    const upstoxToken = process.env.UPSTOX_ANALYTICS_TOKEN;
    if (!upstoxToken) {
      return NextResponse.json(
        { success: false, engine_version: ENGINE_VERSION, error: "UPSTOX_ANALYTICS_TOKEN is not configured on the server." },
        { status: 500 }
      );
    }

    const client = userClient(token);
    const { data: authData, error: authError } = await client.auth.getUser(token);

    if (authError || !authData?.user) {
      return NextResponse.json(
        { success: false, engine_version: ENGINE_VERSION, error: "Invalid session." },
        { status: 401 }
      );
    }

    const { data: holdings, error: holdingsError } = await client
      .from("holdings")
      .select("instrument_id")
      .eq("user_id", authData.user.id);

    if (holdingsError) throw new Error(holdingsError.message);

    const ids = [...new Set((holdings || []).map((row) => row.instrument_id).filter(Boolean))];

    if (!ids.length) {
      return NextResponse.json({
        success: true,
        engine_version: ENGINE_VERSION,
        quotes: {},
        count: 0,
        requested: 0,
        skipped: 0,
        errors: [],
        fetched_at: new Date().toISOString(),
      });
    }

    // holdings.instrument_id is the internal Supabase instrument id.
    // The Upstox key must come from the instrument record (symbol is stored as the ISIN here).
    const { data: instruments, error: instrumentsError } = await client
      .from("instruments")
      .select("id,symbol,company_name")
      .in("id", ids);

    if (instrumentsError) throw new Error(instrumentsError.message);

    const instrumentById = new Map((instruments || []).map((row) => [String(row.id), row]));
    const quoteTargets = ids
      .map((id) => {
        const instrument = instrumentById.get(String(id));
        return { id: String(id), instrument, key: instrumentKey(instrument) };
      })
      .filter((row) => row.key);

    const skipped = ids.length - quoteTargets.length;
    const quotes = {};
    const errors = [];

    // Upstox supports up to 500 instrument keys per request.
    for (let offset = 0; offset < quoteTargets.length; offset += 500) {
      const batch = quoteTargets.slice(offset, offset + 500);
      const url = `${UPSTOX_URL}?instrument_key=${encodeURIComponent(batch.map((row) => row.key).join(","))}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${upstoxToken}`,
        },
        cache: "no-store",
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        errors.push(body?.errors?.[0]?.message || body?.message || `Upstox HTTP ${response.status}`);
        continue;
      }

      const returned = body?.data || {};
      const targetsByKey = new Map(batch.map((row) => [row.key, row]));

      for (const [responseKey, quote] of Object.entries(returned)) {
        const tokenKey = String(quote?.instrument_token || responseKey).replace(/:/g, "|");
        const target = targetsByKey.get(tokenKey) || batch.find((row) => row.key === responseKey);
        if (!target) continue;

        const lastPrice = Number(quote?.last_price);
        const previousClose = Number(quote?.cp);
        quotes[target.id] = {
          instrument_id: target.id,
          symbol: target.instrument?.symbol || null,
          company_name: target.instrument?.company_name || null,
          last_price: Number.isFinite(lastPrice) ? lastPrice : null,
          previous_close: Number.isFinite(previousClose) ? previousClose : null,
          change: Number.isFinite(lastPrice) && Number.isFinite(previousClose) ? lastPrice - previousClose : null,
          change_pct: Number.isFinite(lastPrice) && Number.isFinite(previousClose) && previousClose !== 0
            ? ((lastPrice - previousClose) / previousClose) * 100
            : null,
          instrument_key: target.key,
        };
      }
    }

    const count = Object.keys(quotes).length;

    return NextResponse.json({
      success: errors.length === 0,
      engine_version: ENGINE_VERSION,
      quotes,
      count,
      requested: quoteTargets.length,
      skipped,
      errors,
      fetched_at: new Date().toISOString(),
    }, { status: errors.length && count === 0 ? 502 : 200 });
  } catch (error) {
    console.error("Market quotes error:", error);
    return NextResponse.json(
      {
        success: false,
        engine_version: ENGINE_VERSION,
        error: error?.message || "Market quote request failed.",
      },
      { status: 500 }
    );
  }
}
