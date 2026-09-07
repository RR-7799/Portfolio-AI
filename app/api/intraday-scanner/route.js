import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "intraday_engine_v1_3";
const UPSTOX = "https://api.upstox.com/v3";
const NSE_INSTRUMENTS = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const NIFTY_LARGEMIDCAP_250 = "https://nsearchives.nseindia.com/content/indices/ind_niftylargemidcap250list.csv";
const MAX_RISK_PCT = 0.6;
const MIN_RISK_PCT = 0.25;
const MIN_SETUP_SCORE = 78;
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const avg = (xs) => { const a = xs.filter(Number.isFinite); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };

function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}
function inTradingWindow() {
  const { weekday, hour, minute } = istParts();
  if (["Sat", "Sun"].includes(weekday)) return false;
  const t = hour * 60 + minute;
  return t >= 9 * 60 + 20 && t <= 15 * 60 + 20;
}

async function auth(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

async function upstox(path, token) {
  const r = await fetch(`${UPSTOX}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await r.text(); let body = {};
  try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
  return { ok: r.ok, status: r.status, body };
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

async function loadLargeMidcap250Symbols() {
  const r = await fetch(NIFTY_LARGEMIDCAP_250, { cache: "no-store", headers: { Accept: "text/csv,*/*" } });
  if (!r.ok) throw new Error(`NIFTY LargeMidcap 250 constituent list unavailable (${r.status}).`);
  const rows = parseCsv(await r.text());
  if (!rows.length) throw new Error("NIFTY LargeMidcap 250 constituent list is empty.");
  const headerIndex = rows.findIndex(row => row.some(cell => /symbol/i.test(cell)));
  if (headerIndex < 0) throw new Error("NIFTY LargeMidcap 250 constituent list has no Symbol column.");
  const header = rows[headerIndex].map(x => x.toLowerCase());
  const symbolIndex = header.findIndex(x => x === "symbol" || x.includes("symbol"));
  if (symbolIndex < 0) throw new Error("NIFTY LargeMidcap 250 constituent list has no usable Symbol column.");
  return new Set(rows.slice(headerIndex + 1).map(row => String(row[symbolIndex] || "").trim().toUpperCase()).filter(Boolean));
}

async function loadUniverse() {
  const [instrumentResponse, indexSymbols] = await Promise.all([
    fetch(NSE_INSTRUMENTS, { cache: "no-store" }),
    loadLargeMidcap250Symbols(),
  ]);
  if (!instrumentResponse.ok) throw new Error(`NSE instrument master unavailable (${instrumentResponse.status}).`);
  const raw = gunzipSync(Buffer.from(await instrumentResponse.arrayBuffer())).toString("utf8");
  const rows = JSON.parse(raw);
  const universe = rows.filter(x => x?.segment === "NSE_EQ" && x?.instrument_type === "EQ" && x?.instrument_key && x?.trading_symbol);
  const selected = universe.filter(x => indexSymbols.has(String(x.trading_symbol).trim().toUpperCase()) && !["BE", "BL", "BZ", "SM", "ST", "SZ"].includes(String(x.security_type || "").toUpperCase()));
  if (selected.length < 240 || selected.length > 260) throw new Error(`NIFTY LargeMidcap 250 mapping produced ${selected.length} NSE equity instruments; refusing to scan an incomplete universe.`);
  return selected;
}

function quoteMap(body) {
  const out = new Map();
  for (const [key, row] of Object.entries(body?.data || {})) {
    const q = row || {};
    out.set(key.replace(":", "|"), { price: n(q.last_price), prev: n(q.prev_close_price ?? q.cp), volume: n(q.ohlc?.volume ?? q.volume), high: n(q.ohlc?.high), low: n(q.ohlc?.low) });
  }
  return out;
}

async function intradayMetrics(key, token) {
  const r = await upstox(`/historical-candle/intraday/${encodeURIComponent(key)}/minutes/5`, token);
  const candles = Array.isArray(r.body?.data?.candles) ? r.body.data.candles : [];
  if (!r.ok || candles.length < 10) return null;
  const ordered = [...candles].reverse();
  const completed = ordered.slice(0, -1);
  if (completed.length < 9) return null;
  const closes = completed.map(x => n(x[4])).filter(v => v != null);
  const highs = completed.map(x => n(x[2])).filter(v => v != null);
  const lows = completed.map(x => n(x[3])).filter(v => v != null);
  const vols = completed.map(x => n(x[5])).filter(v => v != null);
  const last = completed.at(-1);
  const price = n(last?.[4]);
  const recentVol = vols.at(-1);
  const baseline = avg(vols.slice(Math.max(0, vols.length - 21), -1));
  const relativeVolume = baseline && recentVol ? recentVol / baseline : null;
  let pv = 0, vv = 0;
  for (const c of completed) { const h=n(c[2]), l=n(c[3]), v=n(c[5]); if(h!=null&&l!=null&&v!=null){pv += ((h+l)/2)*v; vv += v;} }
  const vwap = vv ? pv / vv : null;
  const priorHigh = Math.max(...highs.slice(-13, -1));
  const priorLow = Math.min(...lows.slice(-13, -1));
  const recentRange = Math.max(...highs.slice(-12)) - Math.min(...lows.slice(-12));
  const recentLow3 = Math.min(...lows.slice(-3));
  const recentHigh3 = Math.max(...highs.slice(-3));
  const momentum5 = closes.length > 6 && closes.at(-7) ? ((price - closes.at(-7)) / closes.at(-7)) * 100 : 0;
  const candleOpen = n(last?.[1]), candleClose = n(last?.[4]);
  const candleBodyPct = candleOpen && candleClose ? Math.abs((candleClose - candleOpen) / candleOpen) * 100 : 0;
  const candleDirection = candleClose > candleOpen ? "LONG" : candleClose < candleOpen ? "SHORT" : "FLAT";
  return { price, relativeVolume, vwap, priorHigh, priorLow, recentRange, recentLow3, recentHigh3, momentum5, candleBodyPct, candleDirection, candles: completed.length };
}

function rankCandidate(meta, quote, metrics) {
  if (!quote?.price || !metrics?.price || !metrics.vwap) return null;
  const entry = quote.price;
  const changePct = quote.prev ? ((entry - quote.prev) / quote.prev) * 100 : 0;
  const rv = metrics.relativeVolume ?? 0;
  const vwapDistancePct = Math.abs((entry - metrics.vwap) / metrics.vwap) * 100;
  const aboveVwap = entry > metrics.vwap;
  const breakoutLong = entry > metrics.priorHigh && metrics.candleDirection === "LONG" && metrics.candleBodyPct >= 0.15 && rv >= 1.5;
  const breakoutShort = entry < metrics.priorLow && metrics.candleDirection === "SHORT" && metrics.candleBodyPct >= 0.15 && rv >= 1.5;
  const longMomentum = changePct > 0.6 && metrics.momentum5 > 0.3 && aboveVwap && metrics.candleDirection === "LONG" && rv >= 1.5;
  const shortMomentum = changePct < -0.6 && metrics.momentum5 < -0.3 && !aboveVwap && metrics.candleDirection === "SHORT" && rv >= 1.5;
  const breakout = breakoutLong || breakoutShort;
  if (!breakout && !longMomentum && !shortMomentum) return null;
  const direction = breakoutLong || longMomentum ? "LONG" : "SHORT";
  const setup = breakout ? (direction === "LONG" ? "VOLUME BREAKOUT" : "VOLUME BREAKDOWN") : direction === "LONG" ? "MOMENTUM" : "MOMENTUM SHORT";
  // Avoid chasing: a live quote already far from VWAP is less attractive even when momentum is strong.
  const maxVwapExtension = breakout ? 1.0 : 0.8;
  if (vwapDistancePct > maxVwapExtension) return null;
  if (breakout) {
    const breakoutDistancePct = Math.abs((entry - (direction === "LONG" ? metrics.priorHigh : metrics.priorLow)) / entry) * 100;
    if (breakoutDistancePct > 0.45) return null;
  }
  let score = 45;
  score += Math.min(20, Math.abs(changePct) * 8);
  score += Math.min(20, Math.max(0, rv - 1) * 12);
  score += aboveVwap === (direction === "LONG") ? 10 : 0;
  score += breakout ? 10 : 0;
  score += metrics.candleBodyPct >= 0.3 ? 5 : 0;
  score = Math.max(0, Math.min(100, score));
  if (score < MIN_SETUP_SCORE) return null;

  // Use recent market structure for the stop. If structure requires too much risk, reject the setup.
  const structuralStop = direction === "LONG" ? metrics.recentLow3 : metrics.recentHigh3;
  const risk = Math.abs(entry - structuralStop);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const riskPct = (risk / entry) * 100;
  if (riskPct < MIN_RISK_PCT || riskPct > MAX_RISK_PCT) return null;
  const stop = structuralStop;
  const target1 = direction === "LONG" ? entry + risk * 2 : entry - risk * 2;
  const target2 = direction === "LONG" ? entry + risk * 3 : entry - risk * 3;
  return {
    instrument_key: meta.instrument_key, trading_symbol: meta.trading_symbol, company_name: meta.name,
    price: entry, change_pct: changePct, volume: quote.volume, relative_volume: rv, vwap: metrics.vwap,
    momentum_score: Number(Math.min(100, 50 + Math.abs(metrics.momentum5) * 20).toFixed(1)),
    volume_score: Number(Math.min(100, 50 + Math.max(0, rv - 1) * 30).toFixed(1)),
    setup_score: Number(score.toFixed(1)), setup, direction, entry_price: entry, stop_loss: stop,
    target_1: target1, target_2: target2, risk_reward: 2, risk_pct: Number(riskPct.toFixed(3)), data_status: "LIVE",
  };
}

export async function GET(request) {
  const user = await auth(request);
  if (!user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Authentication required." }, { status: 401 });
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "UPSTOX_ANALYTICS_TOKEN is missing." }, { status: 500 });
  if (!inTradingWindow()) return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, market_open: false, signal_count: 0, signals: [], message: "Scanner is active only during the NSE intraday window." });
  const started = Date.now();
  try {
    const universe = await loadUniverse();
    const quotes = new Map();
    for (let i = 0; i < universe.length; i += 500) {
      const keys = universe.slice(i, i + 500).map(x => x.instrument_key).join(",");
      const r = await upstox(`/market-quote/quotes?instrument_key=${encodeURIComponent(keys)}`, token);
      if (r.ok) for (const [k, v] of quoteMap(r.body)) quotes.set(k, v);
    }
    const candidates = [];
    for (let i = 0; i < universe.length; i += 8) {
      const batch = await Promise.all(universe.slice(i, i + 8).map(async meta => rankCandidate(meta, quotes.get(meta.instrument_key), await intradayMetrics(meta.instrument_key, token))));
      candidates.push(...batch.filter(Boolean));
    }
    candidates.sort((a, b) => b.setup_score - a.setup_score || a.risk_pct - b.risk_pct);
    const top = candidates.slice(0, 15);
    const scannedAt = new Date().toISOString();
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    let tracked = 0;
    if (top.length) {
      const rows = top.map(x => ({ ...x, scan_at: scannedAt }));
      const { data, error } = await supabase.from("intraday_scan_results").insert(rows).select("id,scan_at,instrument_key,trading_symbol,direction,setup,setup_score,entry_price,stop_loss,target_1,target_2,risk_reward");
      if (error) throw error;
      if (data?.length) {
        const outcomes = data.map(x => ({ signal_id: x.id, instrument_key: x.instrument_key, trading_symbol: x.trading_symbol, direction: x.direction, setup: x.setup, setup_score: x.setup_score, entry_price: x.entry_price, stop_loss: x.stop_loss, target_1: x.target_1, target_2: x.target_2, risk_reward: x.risk_reward, signal_at: x.scan_at, outcome: "OPEN" }));
        const trackedResult = await supabase.from("intraday_signal_outcomes").upsert(outcomes, { onConflict: "signal_id", ignoreDuplicates: true });
        if (trackedResult.error) throw trackedResult.error;
        tracked = data.length;
      }
    }
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, universe: "NIFTY_LARGEMIDCAP_250", universe_count: universe.length, quote_count: quotes.size, intraday_candidates_scanned: universe.length, signal_count: top.length, tracked_signal_count: tracked, risk_policy: { min_setup_score: MIN_SETUP_SCORE, min_risk_pct: MIN_RISK_PCT, max_risk_pct: MAX_RISK_PCT, target1_r: 2, target2_r: 3, stop_policy: "recent_3_candle_structure", max_vwap_extension_pct: 1.0 }, signals: top, scanned_at: scannedAt, elapsed_ms: Date.now() - started });
  } catch (error) {
    console.error("Intraday scanner error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Intraday scan failed." }, { status: 500 });
  }
}
