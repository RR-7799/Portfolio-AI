const UPSTOX_BASE = "https://api.upstox.com/v3";
export const ENGINE_VERSION = "market_regime_v1_1";

const SOURCES = {
  nifty50: "NSE_INDEX|Nifty 50",
  niftyBank: "NSE_INDEX|Nifty Bank",
  indiaVix: "NSE_INDEX|India VIX",
};

function num(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function avg(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function sma(values, period) {
  return values.length >= period ? avg(values.slice(-period)) : null;
}

function returnPct(values, periodsAgo) {
  if (values.length <= periodsAgo) return null;
  const old = values[values.length - 1 - periodsAgo];
  const last = values[values.length - 1];
  return old ? ((last - old) / old) * 100 : null;
}

function parseQuote(body, instrumentKey) {
  const root = body?.data || {};
  const row = root[instrumentKey] || Object.values(root)[0] || {};
  return {
    price: num(row?.last_price ?? row?.ltp ?? row?.last_traded_price),
    previousClose: num(row?.cp ?? row?.previous_close),
    timestamp: row?.ts || null,
  };
}

async function upstoxFetch(path, token) {
  try {
    const response = await fetch(`${UPSTOX_BASE}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw_text: text };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { error: error?.message || "Upstox request failed." },
    };
  }
}

function buildIndexMetrics(body, quote) {
  const candles = body?.data?.candles || [];
  const closes = candles.map((row) => num(row?.[4])).filter((x) => x !== null);
  const price = quote.price ?? closes.at(-1) ?? null;

  if (!price || closes.length < 30) {
    return {
      available: false,
      reason: "Insufficient daily history.",
      price,
      candles: closes.length,
    };
  }

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const return3m = returnPct(closes, 63);
  const return1y = returnPct(closes, 252);

  let trend = "SIDEWAYS";
  if (sma20 && sma50 && sma200) {
    if (price > sma20 && sma20 > sma50 && sma50 > sma200) trend = "STRONG_UPTREND";
    else if (price > sma50 && sma50 > sma200) trend = "UPTREND";
    else if (price < sma20 && sma20 < sma50 && sma50 < sma200) trend = "STRONG_DOWNTREND";
    else if (price < sma50 && sma50 < sma200) trend = "DOWNTREND";
  }

  let score = 50;
  if (sma200) score += price > sma200 ? 15 : -15;
  if (sma50 && sma200) score += sma50 > sma200 ? 10 : -10;
  if (sma20) score += price > sma20 ? 5 : -5;
  if (return3m !== null) score += return3m > 0 ? 10 : -10;
  if (return1y !== null) score += return1y > 0 ? 10 : -10;
  score = Math.max(0, Math.min(100, score));

  return {
    available: true,
    price,
    previous_close: quote.previousClose,
    change_pct: quote.previousClose && price ? ((price - quote.previousClose) / quote.previousClose) * 100 : null,
    trend,
    regime_score: Number(score.toFixed(1)),
    moving_averages: { sma20, sma50, sma200 },
    momentum: { three_month_return_pct: return3m, one_year_return_pct: return1y },
    candles: closes.length,
    last_candle: candles.at(-1)?.[0] || null,
  };
}

function vixAdjustment(vix) {
  if (vix === null) return 0;
  if (vix <= 13) return 5;
  if (vix <= 18) return 0;
  if (vix <= 22) return -5;
  return -10;
}

function classify(score) {
  if (score >= 65) return "BULL";
  if (score <= 40) return "BEAR";
  return "NEUTRAL";
}

function modeFor(regime) {
  if (regime === "BULL") {
    return {
      portfolio_mode: "ACCUMULATE_SELECTIVELY",
      position_target_multiplier: 1,
      buy_multiplier: 1,
      guidance: "Favor high-conviction additions while maintaining position-size and risk guardrails.",
    };
  }
  if (regime === "BEAR") {
    return {
      portfolio_mode: "CAPITAL_PROTECTION",
      position_target_multiplier: 0.6,
      buy_multiplier: 0.35,
      guidance: "Protect capital, demand stronger setups, and avoid aggressive averaging into weakness.",
    };
  }
  return {
    portfolio_mode: "QUALITY_FIRST",
    position_target_multiplier: 0.85,
    buy_multiplier: 0.7,
    guidance: "Prefer selective accumulation in financially strong names and wait for better risk/reward.",
  };
}

export async function calculateMarketRegime() {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) throw new Error("UPSTOX_ANALYTICS_TOKEN is missing.");

  const to = new Date();
  const from = new Date(to.getTime() - 430 * 86400000);
  const toDate = to.toISOString().slice(0, 10);
  const fromDate = from.toISOString().slice(0, 10);

  const jobs = Object.entries(SOURCES).flatMap(([name, key]) => [
    [name, "quote", `/market-quote/ltp?instrument_key=${encodeURIComponent(key)}`],
    [name, "history", `/historical-candle/${encodeURIComponent(key)}/days/1/${toDate}/${fromDate}`],
  ]);

  const responses = await Promise.all(
    jobs.map(async ([name, type, path]) => [name, type, await upstoxFetch(path, token)])
  );

  const map = new Map();
  for (const [name, type, response] of responses) {
    const current = map.get(name) || {};
    current[type] = response;
    map.set(name, current);
  }

  const indicators = {};
  for (const [name, key] of Object.entries(SOURCES)) {
    const item = map.get(name) || {};
    indicators[name] = buildIndexMetrics(item.history?.body, parseQuote(item.quote?.body, key));
    indicators[name].quote_status = item.quote?.status ?? null;
    indicators[name].history_status = item.history?.status ?? null;
    indicators[name].instrument_key = key;
  }

  const nifty = indicators.nifty50;
  const bank = indicators.niftyBank;
  const vix = indicators.indiaVix;
  const vixValue = vix?.price ?? null;
  const availableDirectional = [nifty, bank].filter((x) => x?.available);

  let baseScore = availableDirectional.length
    ? availableDirectional.reduce((sum, x) => sum + x.regime_score, 0) / availableDirectional.length
    : 50;
  const directionalWeight = nifty?.available && bank?.available ? 0.6 : 1;
  if (nifty?.available && bank?.available) baseScore = nifty.regime_score * 0.6 + bank.regime_score * 0.4;

  const regimeScore = Math.max(0, Math.min(100, baseScore + vixAdjustment(vixValue)));
  const regime = classify(regimeScore);
  const mode = modeFor(regime);
  const sourceCount = [nifty, bank, vix].filter((x) => x?.available).length;
  const confidence = sourceCount === 3 ? 100 : sourceCount === 2 ? 75 : sourceCount === 1 ? 50 : 25;

  const rationale = [];
  if (nifty?.available) rationale.push(`Nifty 50 is ${nifty.trend.toLowerCase().replaceAll("_", " ")} with a ${nifty.regime_score.toFixed(0)}/100 directional score.`);
  if (bank?.available) rationale.push(`Nifty Bank is ${bank.trend.toLowerCase().replaceAll("_", " ")} with a ${bank.regime_score.toFixed(0)}/100 directional score.`);
  if (vixValue !== null) rationale.push(`India VIX is ${vixValue.toFixed(2)}, applying a ${vixAdjustment(vixValue) >= 0 ? "+" : ""}${vixAdjustment(vixValue).toFixed(0)} regime adjustment.`);
  rationale.push(mode.guidance);

  return {
    engine_version: ENGINE_VERSION,
    provider: "Upstox",
    fetched_at: new Date().toISOString(),
    regime: {
      label: regime,
      score: Number(regimeScore.toFixed(1)),
      confidence,
      portfolio_mode: mode.portfolio_mode,
      position_target_multiplier: mode.position_target_multiplier,
      buy_multiplier: mode.buy_multiplier,
      guidance: mode.guidance,
    },
    indicators: { nifty50: nifty, nifty_bank: bank, india_vix: vix },
    rationale,
    guardrails: {
      bull: "Normal accumulation rules remain active.",
      neutral: "Require stronger conviction before increasing position sizes.",
      bear: "Reduce aggressive additions; prioritize risk control and high-conviction setups.",
    },
    source_health: {
      available_sources: sourceCount,
      total_sources: 3,
      directional_sources: availableDirectional.length,
      directional_weighting: directionalWeight,
    },
  };
}
