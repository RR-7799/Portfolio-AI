import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ENGINE_VERSION = "intraday_close_benchmark_v1";
const UPSTOX = "https://api.upstox.com/v3";
const CLOSE_HOUR = 15;
const CLOSE_MINUTE = 20;

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function istDateKey(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function closeBoundary(date = new Date()) { return new Date(`${istDateKey(date)}T15:20:00+05:30`); }
function isWeekday(date = new Date()) { const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(date); return !["Sat", "Sun"].includes(day); }
function rMultiple(signal, exitPrice) { const entry = n(signal.entry_price), stop = n(signal.stop_loss), exit = n(exitPrice), risk = Math.abs(entry - stop); if (!Number.isFinite(entry) || !Number.isFinite(exit) || !risk) return null; return signal.direction === "LONG" ? (exit - entry) / risk : (entry - exit) / risk; }
function returnPct(signal, exitPrice) { const entry = n(signal.entry_price), exit = n(exitPrice); if (!Number.isFinite(entry) || !Number.isFinite(exit) || !entry) return null; return signal.direction === "LONG" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100; }
async function authContext(request) {
  const pipeline = process.env.PIPELINE_SECRET || "", cron = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "", pipelineHeader = request.headers.get("x-pipeline-secret") || "";
  if ((pipeline && (pipelineHeader === pipeline || authorization === `Bearer ${pipeline}`)) || (cron && authorization === `Bearer ${cron}`)) return { system: true, userId: null };
  const token = authorization.replace(/^Bearer\s+/i, "").trim(); if (!token) return null;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token); return error || !data?.user ? null : { system: false, userId: data.user.id };
}
async function upstox(path, token) { const r = await fetch(`${UPSTOX}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store" }); const text = await r.text(); let body = {}; try { body = JSON.parse(text); } catch {} return { ok: r.ok, status: r.status, body }; }
function quoteMap(body) { const out = new Map(); for (const [key, row] of Object.entries(body?.data || {})) { const q = row || {}; const k = String(q.instrument_token || key.replace(":", "|")).trim(); out.set(k, n(q.last_price)); } return out; }

export async function GET(request) {
  const auth = await authContext(request); if (!auth) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  const token = process.env.UPSTOX_ANALYTICS_TOKEN; if (!token) return NextResponse.json({ success: false, error: "UPSTOX_ANALYTICS_TOKEN is missing." }, { status: 500 });
  const now = new Date(), closeAt = closeBoundary(now);
  if (!isWeekday(now)) return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, evaluated: 0, message: "No market-close benchmark on weekends." });
  if (now < closeAt) return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, evaluated: 0, message: "Market close has not occurred yet.", market_close_at: closeAt.toISOString() });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const dayStart = new Date(`${istDateKey(now)}T00:00:00+05:30`).toISOString();
  const dayEnd = new Date(`${istDateKey(now)}T23:59:59+05:30`).toISOString();
  try {
    let query = supabase.from("intraday_signal_outcomes").select("*").gte("signal_at", dayStart).lte("signal_at", dayEnd).is("market_close_at", null).order("signal_at", { ascending: true }).limit(5000);
    if (!auth.system) query = query.eq("user_id", auth.userId);
    const { data: signals, error } = await query; if (error) throw error;
    if (!signals?.length) return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, evaluated: 0, market_close_at: closeAt.toISOString(), message: "No unbenchmarked paper trades for today." });
    const keys = [...new Set(signals.map(s => s.instrument_key))], prices = new Map();
    for (let i = 0; i < keys.length; i += 500) { const q = await upstox(`/market-quote/quotes?instrument_key=${encodeURIComponent(keys.slice(i, i + 500).join(","))}`, token); if (q.ok) for (const [key, price] of quoteMap(q.body)) prices.set(key, price); }
    let evaluated = 0, failed = 0, wins = 0, losses = 0;
    for (let i = 0; i < signals.length; i += 5) {
      await Promise.all(signals.slice(i, i + 5).map(async signal => {
        try {
          const encoded = encodeURIComponent(signal.instrument_key);
          const r = await upstox(`/historical-candle/intraday/${encoded}/minutes/1`, token);
          let candles = Array.isArray(r.body?.data?.candles) ? [...r.body.data.candles].reverse() : [];
          const signalMs = new Date(signal.signal_at).getTime(), closeMs = closeAt.getTime();
          const candle = candles.filter(c => { const t = new Date(c?.[0]).getTime(); return Number.isFinite(t) && t >= signalMs && t <= closeMs; }).at(-1);
          const closePrice = n(candle?.[4]) ?? prices.get(signal.instrument_key) ?? null;
          if (closePrice == null) throw new Error("No market-close price available.");
          const rr = rMultiple(signal, closePrice), rp = returnPct(signal, closePrice);
          const directional = signal.direction === "LONG" ? closePrice > Number(signal.entry_price) : closePrice < Number(signal.entry_price);
          const outcome = rr > 0 ? "WIN" : rr < 0 ? "LOSS" : "FLAT";
          const { error: updateError } = await supabase.from("intraday_signal_outcomes").update({ market_close_price: closePrice, market_close_return_pct: rp, market_close_realized_r: rr, market_close_directional: directional, market_close_outcome: outcome, market_close_at: closeAt.toISOString() }).eq("id", signal.id).eq("user_id", signal.user_id).is("market_close_at", null);
          if (updateError) throw updateError;
          evaluated++; if (outcome === "WIN") wins++; if (outcome === "LOSS") losses++;
        } catch (error) { failed++; console.error("Intraday market-close benchmark failed", signal.id, error); }
      }));
    }
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, evaluated, wins, losses, failed, market_close_at: closeAt.toISOString(), benchmark_definition: "Directional paper-trade result measured at the NSE market-close price; this does not overwrite the original 10/20/30-minute trade outcome." });
  } catch (error) {
    console.error("Intraday market-close benchmark error", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Market-close benchmark failed." }, { status: 500 });
  }
}
