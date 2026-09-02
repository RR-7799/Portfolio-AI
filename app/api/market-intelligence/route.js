import { NextResponse } from "next/server";

const UPSTOX_BASE = "https://api.upstox.com/v3";
const ENGINE_VERSION = "market_intelligence_v1_0";

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function avg(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function sma(values, period) {
  if (values.length < period) return null;
  return avg(values.slice(-period));
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let e = avg(values.slice(0, period));
  out.push(e);
  for (let i = period; i < values.length; i += 1) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    const gain = Math.max(d, 0);
    const loss = Math.max(-d, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1][4];
    const high = candles[i][2];
    const low = candles[i][3];
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (tr.length < period) return null;
  let value = avg(tr.slice(0, period));
  for (let i = period; i < tr.length; i += 1) {
    value = ((value * (period - 1)) + tr[i]) / period;
  }
  return value;
}

function returnPct(values, periodsAgo) {
  if (values.length <= periodsAgo) return null;
  const old = values[values.length - 1 - periodsAgo];
  const last = values[values.length - 1];
  if (!old) return null;
  return ((last - old) / old) * 100;
}

function percentile(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const idx = (xs.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

function parseQuote(body, instrumentKey) {
  const root = body?.data || {};
  const direct = root[instrumentKey];
  const first = direct || Object.values(root)[0] || {};
  return {
    ltp: n(first?.last_price ?? first?.ltp ?? first?.last_traded_price),
    cp: n(first?.cp ?? first?.previous_close),
    volume: n(first?.volume),
    timestamp: first?.ts || null,
  };
}

async function upstoxFetch(path, token) {
  try {
    const r = await fetch(`${UPSTOX_BASE}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw_text: text }; }
    return { ok: r.ok, status: r.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: error?.message || "Upstox request failed" } };
  }
}

function buildTechnical(candles, quote) {
  const closes = candles.map((x) => n(x?.[4])).filter((x) => x !== null);
  const highs = candles.map((x) => n(x?.[2])).filter((x) => x !== null);
  const lows = candles.map((x) => n(x?.[3])).filter((x) => x !== null);
  const volumes = candles.map((x) => n(x?.[5])).filter((x) => x !== null);
  const price = quote.ltp ?? closes.at(-1) ?? null;

  if (!price || closes.length < 30) {
    return { available: false, reason: "Insufficient daily candle history." };
  }

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.length && ema26.length ? ema12.at(-1) - ema26.at(-1) : null;
  const macdSeries = [];
  const offset = 26 - 12;
  if (ema12.length && ema26.length) {
    for (let i = 0; i < ema26.length; i += 1) macdSeries.push(ema12[i + offset] - ema26[i]);
  }
  const signalSeries = emaSeries(macdSeries, 9);
  const signal = signalSeries.at(-1) ?? null;
  const macdHist = macdLine !== null && signal !== null ? macdLine - signal : null;
  const atr14 = atr(candles, 14);
  const dayHigh = Math.max(...highs.slice(-252));
  const dayLow = Math.min(...lows.slice(-252));
  const recent20High = Math.max(...highs.slice(-20));
  const recent20Low = Math.min(...lows.slice(-20));
  const recent50High = Math.max(...highs.slice(-50));
  const recent50Low = Math.min(...lows.slice(-50));
  const avgVol20 = sma(volumes, 20);
  const latestVol = volumes.at(-1) ?? null;
  const volumeRatio = latestVol && avgVol20 ? latestVol / avgVol20 : null;
  const returns = {
    one_month: returnPct(closes, 21),
    three_month: returnPct(closes, 63),
    six_month: returnPct(closes, 126),
    one_year: returnPct(closes, 252),
  };

  const dailyReturns = [];
  for (let i = Math.max(1, closes.length - 21); i < closes.length; i += 1) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const mean = avg(dailyReturns) || 0;
  const variance = avg(dailyReturns.map((x) => (x - mean) ** 2)) || 0;
  const volatility20d = Math.sqrt(variance) * Math.sqrt(252) * 100;

  let trend = "SIDEWAYS";
  if (s20 && s50 && s200) {
    if (price > s20 && s20 > s50 && s50 > s200) trend = "STRONG_UPTREND";
    else if (price > s50 && s50 > s200) trend = "UPTREND";
    else if (price < s20 && s20 < s50 && s50 < s200) trend = "STRONG_DOWNTREND";
    else if (price < s50 && s50 < s200) trend = "DOWNTREND";
  }

  let technicalScore = 50;
  if (s20 && price > s20) technicalScore += 8; else if (s20) technicalScore -= 6;
  if (s50 && price > s50) technicalScore += 8; else if (s50) technicalScore -= 7;
  if (s200 && price > s200) technicalScore += 10; else if (s200) technicalScore -= 10;
  if (rsi14 !== null) {
    if (rsi14 >= 55 && rsi14 <= 70) technicalScore += 10;
    else if (rsi14 > 70) technicalScore -= 2;
    else if (rsi14 < 40) technicalScore -= 8;
  }
  if (macdHist !== null) technicalScore += macdHist > 0 ? 8 : -8;
  if (returns.three_month !== null) technicalScore += returns.three_month > 0 ? 6 : -6;
  if (returns.one_year !== null) technicalScore += returns.one_year > 0 ? 5 : -5;
  technicalScore = Math.max(0, Math.min(100, technicalScore));

  const bullish = ["STRONG_UPTREND", "UPTREND"].includes(trend);
  const entryLow = bullish && s20 ? s20 * 0.98 : recent20Low;
  const entryHigh = bullish && s20 ? s20 * 1.02 : (s50 || recent20High);
  const stop = bullish ? Math.min(recent20Low, s50 || recent20Low) * 0.97 : Math.min(recent20Low * 0.97, price * 0.93);
  const target1 = Math.max(recent20High, recent50High, price * 1.08);
  const target2 = Math.max(dayHigh, price * 1.15);
  const risk = Math.max(price - stop, 0.01);
  const reward1 = Math.max(target1 - price, 0);

  return {
    available: true,
    price,
    previous_close: quote.cp,
    change: quote.cp ? price - quote.cp : null,
    change_pct: quote.cp ? ((price - quote.cp) / quote.cp) * 100 : null,
    volume: quote.volume ?? latestVol,
    trend,
    technical_score: Number(technicalScore.toFixed(1)),
    moving_averages: { sma20: s20, sma50: s50, sma200: s200 },
    momentum: { rsi14, macd: macdLine, macd_signal: signal, macd_histogram: macdHist, ...returns },
    volatility: { atr14, atr_pct: atr14 && price ? (atr14 / price) * 100 : null, annualized_20d_pct: volatility20d, volume_ratio_20d: volumeRatio },
    levels: {
      week_52_high: dayHigh,
      week_52_low: dayLow,
      recent_20d_high: recent20High,
      recent_20d_low: recent20Low,
      recent_50d_high: recent50High,
      recent_50d_low: recent50Low,
    },
    trade_plan: {
      entry_zone: { low: Math.max(0, entryLow), high: Math.max(0, entryHigh) },
      stop_loss: Math.max(0, stop),
      target_1: target1,
      target_2: target2,
      risk_reward_to_target_1: Number((reward1 / risk).toFixed(2)),
      note: bullish ? "Trend-following pullback zone; wait for price to hold the zone." : "Not a clean trend-following setup; treat levels as reference, not an automatic buy signal.",
    },
    data_points: candles.length,
    last_candle: candles.at(-1)?.[0] || null,
  };
}

export async function GET(request) {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "UPSTOX_ANALYTICS_TOKEN is missing." }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const isin = (searchParams.get("isin") || "").trim().toUpperCase();
  const periodDays = Math.min(Math.max(Number(searchParams.get("days") || 365), 90), 3650);
  if (!isin) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "isin is required." }, { status: 400 });

  const instrumentKey = `NSE_EQ|${isin}`;
  const to = new Date();
  const from = new Date(to.getTime() - periodDays * 86400000);
  const toDate = to.toISOString().slice(0, 10);
  const fromDate = from.toISOString().slice(0, 10);

  const [quoteRes, candlesRes] = await Promise.all([
    upstoxFetch(`/market-quote/ltp?instrument_key=${encodeURIComponent(instrumentKey)}`, token),
    upstoxFetch(`/historical-candle/${encodeURIComponent(instrumentKey)}/days/1/${toDate}/${fromDate}`, token),
  ]);

  if (!quoteRes.ok && !candlesRes.ok) {
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Unable to retrieve Upstox market data.", quote_status: quoteRes.status, candles_status: candlesRes.status }, { status: 502 });
  }

  const quote = parseQuote(quoteRes.body, instrumentKey);
  const candles = candlesRes.body?.data?.candles || [];
  const technical = buildTechnical(candles, quote);

  return NextResponse.json({
    success: true,
    engine_version: ENGINE_VERSION,
    provider: "Upstox",
    instrument: { isin, instrument_key: instrumentKey },
    quote_status: quoteRes.status,
    historical_status: candlesRes.status,
    technical,
    fetched_at: new Date().toISOString(),
  });
}
