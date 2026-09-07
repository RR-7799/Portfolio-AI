import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "intraday_engine_v1_1";
const UPSTOX = "https://api.upstox.com/v3";
const NSE_INSTRUMENTS = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const NIFTY_LARGEMIDCAP_250 = "https://nsearchives.nseindia.com/content/indices/ind_niftylargemidcap250list.csv";
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const avg = (xs) => { const a = xs.filter(Number.isFinite); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };

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
    } else if (ch === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
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
  if (!r.ok || candles.length < 8) return null;
  const ordered = [...candles].reverse();
  const closes = ordered.map(x => n(x[4])).filter(v => v != null);
  const highs = ordered.map(x => n(x[2])).filter(v => v != null);
  const lows = ordered.map(x => n(x[3])).filter(v => v != null);
  const vols = ordered.map(x => n(x[5])).filter(v => v != null);
  const last = ordered.at(-1);
  const price = n(last?.[4]);
  const recentVol = vols.at(-1);
  const baseline = avg(vols.slice(Math.max(0, vols.length - 21), -1));
  const relativeVolume = baseline && recentVol ? recentVol / baseline : null;
  let pv = 0, vv = 0;
  for (const c of ordered) { const h=n(c[2]), l=n(c[3]), v=n(c[5]); if(h!=null&&l!=null&&v!=null){pv += ((h+l)/2)*v; vv += v;} }
  const vwap = vv ? pv / vv : null;
  const priorHigh = Math.max(...highs.slice(0, -1).slice(-12));
  const priorLow = Math.min(...lows.slice(0, -1).slice(-12));
  const recentRange = Math.max(...highs.slice(-12)) - Math.min(...lows.slice(-12));
  const momentum5 = closes.length > 6 && closes.at(-7) ? ((price - closes.at(-7)) / closes.at(-7)) * 100 : 0;
  return { price, relativeVolume, vwap, priorHigh, priorLow, recentRange, momentum5, candles: ordered.length };
}

function rankCandidate(meta, quote, metrics) {
  if (!quote?.price || !metrics?.price) return null;
  const changePct = quote.prev ? ((quote.price - quote.prev) / quote.prev) * 100 : 0;
  const rv = metrics.relativeVolume ?? 0;
  const aboveVwap = metrics.vwap ? quote.price > metrics.vwap : false;
  const breakout = quote.price > metrics.priorHigh && rv >= 1.5;
  const breakdown = quote.price < metrics.priorLow && rv >= 1.5;
  const longMomentum = changePct > 0.6 && metrics.momentum5 > 0.3 && aboveVwap && rv >= 1.2;
  const shortMomentum = changePct < -0.6 && metrics.momentum5 < -0.3 && !aboveVwap && rv >= 1.2;
  if (!breakout && !breakdown && !longMomentum && !shortMomentum) return null;
  const direction = breakout || longMomentum ? "LONG" : "SHORT";
  const setup = breakout ? "VOLUME BREAKOUT" : breakdown ? "VOLUME BREAKDOWN" : direction === "LONG" ? "MOMENTUM" : "MOMENTUM SHORT";
  let score = 45;
  score += Math.min(20, Math.abs(changePct) * 8);
  score += Math.min(20, Math.max(0, rv - 1) * 12);
  score += aboveVwap === (direction === "LONG") ? 10 : 0;
  score += breakout || breakdown ? 10 : 0;
  score = Math.max(0, Math.min(100, score));
  const entry = quote.price;
  const range = Math.max(metrics.recentRange || entry * 0.01, entry * 0.003);
  const risk = range * 0.35;
  const stop = direction === "LONG" ? entry - risk : entry + risk;
  const target1 = direction === "LONG" ? entry + risk * 2 : entry - risk * 2;
  const target2 = direction === "LONG" ? entry + risk * 3 : entry - risk * 3;
  return { instrument_key: meta.instrument_key, trading_symbol: meta.trading_symbol, company_name: meta.name, price: entry, change_pct: changePct, volume: quote.volume, relative_volume: rv, vwap: metrics.vwap, momentum_score: Number(Math.min(100, 50 + Math.abs(metrics.momentum5) * 20).toFixed(1)), volume_score: Number(Math.min(100, 50 + Math.max(0, rv - 1) * 30).toFixed(1)), setup_score: Number(score.toFixed(1)), setup, direction, entry_price: entry, stop_loss: stop, target_1: target1, target_2: target2, risk_reward: 2, data_status: "LIVE" };
}

export async function GET(request) {
  const user = await auth(request);
  if (!user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Authentication required." }, { status: 401 });
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "UPSTOX_ANALYTICS_TOKEN is missing." }, { status: 500 });
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
    candidates.sort((a, b) => b.setup_score - a.setup_score);
    const top = candidates.slice(0, 25);
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (top.length) {
      const rows = top.map(x => ({ ...x, scan_at: new Date().toISOString() }));
      const { error } = await supabase.from("intraday_scan_results").insert(rows);
      if (error) throw error;
    }
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, universe: "NIFTY_LARGEMIDCAP_250", universe_count: universe.length, quote_count: quotes.size, intraday_candidates_scanned: universe.length, signal_count: top.length, signals: top, scanned_at: new Date().toISOString(), elapsed_ms: Date.now() - started });
  } catch (error) {
    console.error("Intraday scanner error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Intraday scan failed." }, { status: 500 });
  }
}
