import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "intraday_outcome_engine_v1_0";
const UPSTOX = "https://api.upstox.com/v3";

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function authOk(request) {
  const pipeline = process.env.PIPELINE_SECRET || "";
  const cron = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const pipelineHeader = request.headers.get("x-pipeline-secret") || "";
  return Boolean(
    (pipeline && (pipelineHeader === pipeline || authorization === `Bearer ${pipeline}`)) ||
    (cron && authorization === `Bearer ${cron}`)
  );
}
function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}
function sameIstDay(a, b) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(a)) === fmt.format(new Date(b));
}
function marketClosed() {
  const { weekday, hour, minute } = istParts();
  if (["Sat", "Sun"].includes(weekday)) return true;
  return hour * 60 + minute >= 15 * 60 + 25;
}
async function upstox(path, token) {
  const r = await fetch(`${UPSTOX}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await r.text(); let body = {};
  try { body = JSON.parse(text); } catch { body = {}; }
  return { ok: r.ok, status: r.status, body };
}
function quoteMap(body) {
  const out = new Map();
  for (const [key, row] of Object.entries(body?.data || {})) out.set(key.replace(":", "|"), n(row?.last_price));
  return out;
}
function crossingOutcome(signal, candle) {
  const high = n(candle?.[2]);
  const low = n(candle?.[3]);
  if (high == null || low == null) return null;
  if (signal.direction === "LONG") {
    const stop = low <= Number(signal.stop_loss);
    const t2 = high >= Number(signal.target_2);
    const t1 = high >= Number(signal.target_1);
    if (stop) return { outcome: "STOP_LOSS", price: Number(signal.stop_loss) };
    if (t2) return { outcome: "TARGET_2", price: Number(signal.target_2) };
    if (t1) return { outcome: "TARGET_1", price: Number(signal.target_1) };
  } else {
    const stop = high >= Number(signal.stop_loss);
    const t2 = low <= Number(signal.target_2);
    const t1 = low <= Number(signal.target_1);
    if (stop) return { outcome: "STOP_LOSS", price: Number(signal.stop_loss) };
    if (t2) return { outcome: "TARGET_2", price: Number(signal.target_2) };
    if (t1) return { outcome: "TARGET_1", price: Number(signal.target_1) };
  }
  return null;
}
function rMultiple(signal, exitPrice) {
  const entry = Number(signal.entry_price), stop = Number(signal.stop_loss), exit = Number(exitPrice);
  const risk = Math.abs(entry - stop);
  if (!risk) return null;
  return signal.direction === "LONG" ? (exit - entry) / risk : (entry - exit) / risk;
}

async function evaluateSignal(signal, token, now, currentPrice) {
  if (!sameIstDay(signal.signal_at, now)) {
    if (marketClosed() && currentPrice != null) {
      return { status: "CLOSED", outcome: "EXPIRED", current_price: currentPrice, return_pct: ((currentPrice - Number(signal.entry_price)) / Number(signal.entry_price)) * (signal.direction === "LONG" ? 100 : -100), realized_r: rMultiple(signal, currentPrice), closed_at: now, last_checked_at: now };
    }
    return { status: "OPEN", outcome: "OPEN", current_price: currentPrice, last_checked_at: now };
  }

  const encoded = encodeURIComponent(signal.instrument_key);
  let candles = [];
  const oneMinute = await upstox(`/historical-candle/intraday/${encoded}/minutes/1`, token);
  if (oneMinute.ok && Array.isArray(oneMinute.body?.data?.candles)) candles = oneMinute.body.data.candles;
  if (candles.length < 2) {
    const fiveMinute = await upstox(`/historical-candle/intraday/${encoded}/minutes/5`, token);
    if (fiveMinute.ok && Array.isArray(fiveMinute.body?.data?.candles)) candles = fiveMinute.body.data.candles;
  }
  candles = [...candles].reverse();
  const signalMs = new Date(signal.signal_at).getTime();
  const usable = candles.filter(c => {
    const t = new Date(c?.[0]).getTime();
    return Number.isFinite(t) && t >= signalMs;
  });

  let mae = 0;
  let mfe = 0;
  const entry = Number(signal.entry_price);
  for (const candle of usable) {
    const high = n(candle?.[2]), low = n(candle?.[3]);
    if (high == null || low == null) continue;
    const favorable = signal.direction === "LONG" ? ((high - entry) / entry) * 100 : ((entry - low) / entry) * 100;
    const adverse = signal.direction === "LONG" ? ((entry - low) / entry) * 100 : ((high - entry) / entry) * 100;
    mfe = Math.max(mfe, favorable);
    mae = Math.max(mae, adverse);
    const hit = crossingOutcome(signal, candle);
    if (hit) {
      const returnPct = signal.direction === "LONG" ? ((hit.price - entry) / entry) * 100 : ((entry - hit.price) / entry) * 100;
      const candleAt = new Date(candle[0]).toISOString();
      return {
        status: "CLOSED", outcome: hit.outcome, current_price: hit.price, return_pct: returnPct,
        realized_r: rMultiple(signal, hit.price), mae_pct: mae, mfe_pct: mfe,
        hit_stop_at: hit.outcome === "STOP_LOSS" ? candleAt : null,
        hit_target_1_at: hit.outcome === "TARGET_1" || hit.outcome === "TARGET_2" ? candleAt : null,
        hit_target_2_at: hit.outcome === "TARGET_2" ? candleAt : null,
        closed_at: candleAt, last_checked_at: now,
      };
    }
  }

  if (marketClosed() && currentPrice != null) {
    const returnPct = signal.direction === "LONG" ? ((currentPrice - entry) / entry) * 100 : ((entry - currentPrice) / entry) * 100;
    return { status: "CLOSED", outcome: "EXPIRED", current_price: currentPrice, return_pct: returnPct, realized_r: rMultiple(signal, currentPrice), mae_pct: mae, mfe_pct: mfe, closed_at: now, last_checked_at: now };
  }
  const returnPct = currentPrice == null ? null : (signal.direction === "LONG" ? ((currentPrice - entry) / entry) * 100 : ((entry - currentPrice) / entry) * 100);
  const runningR = currentPrice == null ? null : rMultiple(signal, currentPrice);
  return { status: "OPEN", outcome: "OPEN", current_price: currentPrice, return_pct: returnPct, realized_r: runningR, mae_pct: mae, mfe_pct: mfe, last_checked_at: now };
}

export async function GET(request) {
  if (!authOk(request)) return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) return NextResponse.json({ success: false, error: "UPSTOX_ANALYTICS_TOKEN is missing." }, { status: 500 });
  const started = Date.now();
  const now = new Date();
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: signals, error } = await supabase.from("intraday_signal_outcomes").select("*").eq("status", "OPEN").order("signal_at", { ascending: true }).limit(500);
    if (error) throw error;
    if (!signals?.length) return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, evaluated: 0, closed: 0, open: 0, elapsed_ms: Date.now() - started });

    const keys = [...new Set(signals.map(s => s.instrument_key))];
    const prices = new Map();
    for (let i = 0; i < keys.length; i += 500) {
      const batch = keys.slice(i, i + 500).join(",");
      const q = await upstox(`/market-quote/quotes?instrument_key=${encodeURIComponent(batch)}`, token);
      if (q.ok) for (const [key, price] of quoteMap(q.body)) prices.set(key, price);
    }

    let evaluated = 0, closed = 0, open = 0, failed = 0;
    for (let i = 0; i < signals.length; i += 5) {
      const batch = signals.slice(i, i + 5);
      await Promise.all(batch.map(async signal => {
        try {
          const result = await evaluateSignal(signal, token, now, prices.get(signal.instrument_key) ?? null);
          const { error: updateError } = await supabase.from("intraday_signal_outcomes").update(result).eq("id", signal.id).eq("status", "OPEN");
          if (updateError) throw updateError;
          evaluated++;
          if (result.status === "CLOSED") closed++; else open++;
        } catch (e) {
          failed++;
          console.error("Intraday outcome evaluation failed", signal.id, e);
        }
      }));
    }
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, evaluated, closed, open, failed, elapsed_ms: Date.now() - started, evaluated_at: now.toISOString() });
  } catch (error) {
    console.error("Intraday outcome evaluator error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Evaluation failed." }, { status: 500 });
  }
}
