import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "market_quotes_v1_0";
const UPSTOX_URL = "https://api.upstox.com/v3/market-quote/ltp";

function userClient(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function instrumentKey(id) {
  const value = String(id || "").trim();
  if (!value) return null;
  return value.includes("|") ? value : `NSE_EQ|${value}`;
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

    const instrumentIds = [...new Set((holdings || []).map((x) => x.instrument_id).filter(Boolean))];
    const keys = instrumentIds.map(instrumentKey).filter(Boolean);

    if (!keys.length) {
      return NextResponse.json({
        success: true,
        engine_version: ENGINE_VERSION,
        quotes: {},
        count: 0,
        fetched_at: new Date().toISOString(),
      });
    }

    // Upstox supports up to 500 instrument keys per request.
    const quotes = {};
    const errors = [];

    for (let offset = 0; offset < keys.length; offset += 500) {
      const batch = keys.slice(offset, offset + 500);
      const url = `${UPSTOX_URL}?instrument_key=${encodeURIComponent(batch.join(","))}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${process.env.UPSTOX_ANALYTICS_TOKEN}`,
        },
        cache: "no-store",
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        errors.push(body?.errors?.[0]?.message || body?.message || `Upstox HTTP ${response.status}`);
        continue;
      }

      Object.assign(quotes, body?.data || {});
    }

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      quotes,
      count: Object.keys(quotes).length,
      requested: keys.length,
      errors,
      fetched_at: new Date().toISOString(),
    });
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
