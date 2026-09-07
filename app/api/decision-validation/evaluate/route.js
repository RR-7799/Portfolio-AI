import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ENGINE_VERSION = "decision_validation_v1_1";
const SCORE_VERSION = "ai_scorer_v5_5";
const V3 = "https://api.upstox.com/v3";
const V2 = "https://api.upstox.com/v2";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };

function authorized(request) {
  const pipeline = process.env.PIPELINE_SECRET || "";
  const cron = process.env.CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  return !!((pipeline && (request.headers.get("x-pipeline-secret") === pipeline || auth === `Bearer ${pipeline}`)) || (cron && auth === `Bearer ${cron}`));
}

async function fetchJson(url, token) {
  const r = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await r.text();
  let body = {};
  try { body = JSON.parse(text); } catch { body = {}; }
  return { ok: r.ok, status: r.status, body };
}

async function resolveKey(isin, token) {
  const clean = String(isin || "").trim().toUpperCase();
  if (!clean) return null;
  const r = await fetchJson(`${V2}/instruments/search?query=${encodeURIComponent(clean)}&exchanges=NSE&segments=EQ&instrument_types=EQ&page_number=1&records=30`, token);
  const rows = Array.isArray(r.body?.data) ? r.body.data : [];
  const match = rows.find(x => String(x?.isin || "").toUpperCase() === clean && String(x?.segment || "").toUpperCase() === "NSE_EQ" && String(x?.instrument_type || "").toUpperCase() === "EQ") || rows.find(x => String(x?.isin || "").toUpperCase() === clean && String(x?.segment || "").toUpperCase() === "NSE_EQ");
  return match?.instrument_key || null;
}

function isoDate(v) { return new Date(v).toISOString().slice(0, 10); }
function targetDate(snapshot, tradingDays) {
  const d = new Date(snapshot);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + Math.ceil(tradingDays * 1.55) + 4);
  return d;
}
function pickForwardClose(candles, snapshot, tradingDays) {
  const snapMs = new Date(snapshot).getTime();
  const future = candles
    .map(c => ({ t: new Date(c[0]).getTime(), close: n(c[4]) }))
    .filter(x => x.t > snapMs && x.close != null)
    .sort((a, b) => a.t - b.t);
  return future[tradingDays - 1] || null;
}

async function historicalCloses(isin, snapshot, token) {
  let key = `NSE_EQ|${String(isin || "").trim().toUpperCase()}`;
  const to = new Date();
  const from = new Date(snapshot);
  from.setUTCDate(from.getUTCDate() - 2);
  const fetchHistory = async k => fetchJson(`${V3}/historical-candle/${encodeURIComponent(k)}/days/1/${isoDate(to)}/${isoDate(from)}`, token);
  let r = await fetchHistory(key);
  let candles = Array.isArray(r.body?.data?.candles) ? r.body.data.candles : [];
  if (candles.length === 0) {
    const resolved = await resolveKey(isin, token);
    if (resolved) { key = resolved; r = await fetchHistory(key); candles = Array.isArray(r.body?.data?.candles) ? r.body.data.candles : []; }
  }
  return { candles, status: r.status };
}

async function evaluateRow(row, instrument, token) {
  if (!row.reference_price || !instrument?.isin) return { id: row.id, status: "NO_REFERENCE_PRICE" };
  const { candles, status } = await historicalCloses(instrument.isin, row.snapshot_at, token);
  if (!candles.length) return { id: row.id, status: `MARKET_DATA_${status || "UNAVAILABLE"}` };
  const out = { id: row.id };
  for (const [days, field, atField] of [[5, "return_5d_pct", "evaluated_5d_at"], [20, "return_20d_pct", "evaluated_20d_at"], [60, "return_60d_pct", "evaluated_60d_at"]]) {
    const point = pickForwardClose(candles, row.snapshot_at, days);
    if (point) {
      out[field] = Number((((point.close - Number(row.reference_price)) / Number(row.reference_price)) * 100).toFixed(4));
      out[atField] = new Date(point.t).toISOString();
    }
  }
  const completed = [out.return_5d_pct, out.return_20d_pct, out.return_60d_pct].filter(v => v != null).length;
  out.outcome_status = completed === 3 ? "COMPLETE" : completed > 0 ? "PARTIAL" : "PENDING";
  return out;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const [{ data: rows, error: le }, { data: instruments, error: ie }] = await Promise.all([
      admin.from("decision_validation_ledger").select("id,user_id,instrument_id,score_version,snapshot_at,reference_price,thesis_action,return_5d_pct,return_20d_pct,return_60d_pct").eq("score_version", SCORE_VERSION).order("snapshot_at", { ascending: true }).limit(5000),
      admin.from("instruments").select("id,isin,symbol,company_name")
    ]);
    if (le) throw le; if (ie) throw ie;
    const im = new Map((instruments || []).map(x => [x.id, x]));
    const token = process.env.UPSTOX_ANALYTICS_TOKEN;
    if (!token) throw new Error("UPSTOX_ANALYTICS_TOKEN is missing.");
    const work = (rows || []).filter(r => r.reference_price != null && (!r.return_5d_pct || !r.return_20d_pct || !r.return_60d_pct));
    const results = [];
    const concurrency = 5;
    for (let i = 0; i < work.length; i += concurrency) {
      const batch = work.slice(i, i + concurrency);
      const evaluated = await Promise.all(batch.map(r => evaluateRow(r, im.get(r.instrument_id), token)));
      results.push(...evaluated);
    }
    let updated = 0;
    for (const result of results) {
      const patch = { outcome_status: result.outcome_status || result.status || "PENDING" };
      for (const k of ["return_5d_pct", "return_20d_pct", "return_60d_pct", "evaluated_5d_at", "evaluated_20d_at", "evaluated_60d_at"]) if (result[k] != null) patch[k] = result[k];
      if (Object.keys(patch).length > 1 || result.outcome_status) {
        const { error } = await admin.from("decision_validation_ledger").update(patch).eq("id", result.id);
        if (!error) updated++; else console.error("Outcome update error", result.id, error);
      }
    }
    const summary = { rows_considered: work.length, rows_updated: updated, complete: results.filter(x => x.outcome_status === "COMPLETE").length, partial: results.filter(x => x.outcome_status === "PARTIAL").length, pending: results.filter(x => x.outcome_status === "PENDING").length, elapsed_ms: Date.now() - started };
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, score_version: SCORE_VERSION, summary });
  } catch (error) {
    console.error("Decision validation evaluation error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Validation evaluation failed." }, { status: 500 });
  }
}
