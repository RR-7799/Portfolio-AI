import { NextResponse } from "next/server";

const ENGINE_VERSION = "final_decision_v1_0";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

function pct(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function decisionFor({ fundamentalScore, technicalScore, risk, freshness, confidence, weight }) {
  const f = num(fundamentalScore);
  const t = num(technicalScore);
  const r = String(risk || "UNKNOWN").toUpperCase();
  const fr = String(freshness || "MISSING").toUpperCase();
  const c = num(confidence) ?? 0;
  const w = num(weight) ?? 0;
  const blended = f !== null && t !== null ? f * 0.65 + t * 0.35 : f ?? t ?? 0;

  if (fr === "MISSING" || fr === "VERY_STALE") {
    return { decision: blended >= 75 ? "WATCH" : "HOLD", conviction: "LOW", score: blended, reason: "Fundamental data freshness is too weak for a high-conviction action." };
  }

  if (r === "HIGH" && blended < 80) {
    return { decision: blended < 55 ? "EXIT" : "REDUCE", conviction: "MEDIUM", score: blended, reason: "Elevated model risk outweighs the current combined score." };
  }

  if (blended >= 82 && c >= 75 && ["FRESH", "ACCEPTABLE"].includes(fr)) {
    if (w >= 10) return { decision: "HOLD", conviction: "HIGH", score: blended, reason: "Strong combined setup, but the existing position is already concentrated." };
    if (w >= 6) return { decision: "ACCUMULATE ON PULLBACK", conviction: "HIGH", score: blended, reason: "Strong fundamentals and technicals; add only on a controlled pullback." };
    return { decision: "ACCUMULATE", conviction: "HIGH", score: blended, reason: "Strong combined fundamentals and technical trend with adequate data quality." };
  }

  if (blended >= 72) {
    if (w >= 10) return { decision: "HOLD / TRIM ON STRENGTH", conviction: "MEDIUM", score: blended, reason: "Good combined quality, but portfolio concentration is high." };
    if (t !== null && f !== null && t + 12 < f) return { decision: "HOLD / WAIT", conviction: "MEDIUM", score: blended, reason: "Fundamentals are stronger than current technical momentum." };
    return { decision: "HOLD", conviction: "MEDIUM", score: blended, reason: "Balanced setup without enough edge for aggressive accumulation." };
  }

  if (blended >= 58) {
    return { decision: "WATCH", conviction: "LOW", score: blended, reason: "Mixed signals; wait for either improving technical momentum or stronger fundamentals." };
  }

  return { decision: w >= 6 ? "REDUCE" : "EXIT", conviction: "MEDIUM", score: blended, reason: "Weak combined score suggests capital should be redeployed unless the thesis improves." };
}

async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  const body = await r.json();
  return { ok: r.ok, status: r.status, body };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const instrumentId = (searchParams.get("instrument_id") || "").trim();
    if (!instrumentId) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "instrument_id is required." }, { status: 400 });

    const origin = new URL(request.url).origin;
    const stockRes = await getJson(`${origin}/api/stock-intelligence?instrument_id=${encodeURIComponent(instrumentId)}`);
    if (!stockRes.ok || !stockRes.body?.success) {
      return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: stockRes.body?.error || "Unable to load stock intelligence." }, { status: stockRes.status || 502 });
    }

    const stock = stockRes.body;
    const isin = stock.instrument?.symbol;
    const marketRes = isin ? await getJson(`${origin}/api/market-intelligence?isin=${encodeURIComponent(isin)}&days=365`) : { ok: false, status: 400, body: null };
    const market = marketRes.ok && marketRes.body?.success ? marketRes.body : null;

    const fundamentals = stock.ai_score || {};
    const breakdown = fundamentals.breakdown || fundamentals.score_breakdown || {};
    const freshness = breakdown.freshness || {};
    const fundamentalScore = num(fundamentals.total_score);
    const technicalScore = num(market?.technical?.technical_score);
    const weight = num(stock.portfolio?.current_value) && num(stock.portfolio?.portfolio_total_value)
      ? (num(stock.portfolio.current_value) / num(stock.portfolio.portfolio_total_value)) * 100
      : null;

    const result = decisionFor({
      fundamentalScore,
      technicalScore,
      risk: fundamentals.risk_level,
      freshness: freshness.status,
      confidence: breakdown.confidence ?? freshness.effective_confidence,
      weight,
    });

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      instrument: stock.instrument,
      portfolio: stock.portfolio,
      fundamentals: {
        score: fundamentalScore,
        action: fundamentals.action || null,
        rating: fundamentals.rating || null,
        risk: fundamentals.risk_level || null,
        confidence: breakdown.confidence ?? freshness.effective_confidence ?? null,
        freshness: freshness.status || null,
      },
      technicals: market ? {
        score: technicalScore,
        trend: market.technical?.trend || null,
        price: market.technical?.price ?? null,
        change_pct: market.technical?.change_pct ?? null,
        rsi14: market.technical?.momentum?.rsi14 ?? null,
        momentum_3m: market.technical?.momentum?.three_month ?? null,
        momentum_1y: market.technical?.momentum?.one_year ?? null,
        entry_zone: market.technical?.trade_plan?.entry_zone || null,
        stop_loss: market.technical?.trade_plan?.stop_loss ?? null,
        target_1: market.technical?.trade_plan?.target_1 ?? null,
        target_2: market.technical?.trade_plan?.target_2 ?? null,
        risk_reward: market.technical?.trade_plan?.risk_reward_to_target_1 ?? null,
      } : null,
      final: {
        decision: result.decision,
        conviction: result.conviction,
        score: Number(result.score.toFixed(1)),
        position_weight_pct: weight === null ? null : Number(weight.toFixed(2)),
        reason: result.reason,
      },
      market_available: Boolean(market),
    });
  } catch (error) {
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Final decision failed." }, { status: 500 });
  }
}
