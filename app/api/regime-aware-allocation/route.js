import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "regime_aware_allocation_v1_0";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function riskCap(risk) {
  const r = String(risk || "UNKNOWN").toUpperCase();
  return r === "HIGH" ? 4 : r === "MODERATE" ? 7 : 10;
}

function baseTarget(score, risk) {
  const s = num(score);
  if (s === null) return 0;
  let t = s >= 82 ? 8 : s >= 72 ? 6 : s >= 60 ? 4 : s >= 50 ? 2 : 0;
  const r = String(risk || "UNKNOWN").toUpperCase();
  if (r === "HIGH") t *= 0.45;
  else if (r === "MODERATE") t *= 0.8;
  return clamp(t, 0, riskCap(r));
}

function regimeRules(label) {
  const r = String(label || "NEUTRAL").toUpperCase();
  if (r === "BULL") return { deployPct: 1, targetMultiplier: 1, scoreFloor: 72, freshRequired: true, note: "Normal selective deployment." };
  if (r === "BEAR") return { deployPct: 0.35, targetMultiplier: 0.6, scoreFloor: 90, freshRequired: true, note: "Defensive mode: deploy only 35% of new capital and prefer exceptional setups." };
  return { deployPct: 0.7, targetMultiplier: 0.85, scoreFloor: 82, freshRequired: true, note: "Neutral mode: deploy 70% of new capital and favor stronger setups." };
}

function opportunity(row, regime) {
  const score = num(row.total_score) ?? 0;
  const risk = String(row.risk_level || "UNKNOWN").toUpperCase();
  const fresh = String(row.freshness || "MISSING").toUpperCase();
  const confidence = num(row.confidence) ?? 0;
  const action = String(row.action || "WATCH").toUpperCase();
  const positionPenalty = clamp((num(row.current_weight) ?? 0) / 12, 0, 1) * 18;
  const riskPenalty = risk === "HIGH" ? 28 : risk === "MODERATE" ? 12 : 0;
  const freshnessPenalty = ["MISSING", "VERY_STALE", "STALE"].includes(fresh) ? 24 : fresh === "AGING" ? 10 : 0;
  const actionPenalty = action === "REDUCE" ? 30 : 0;
  const conviction = confidence * 0.08;
  let x = score + conviction - positionPenalty - riskPenalty - freshnessPenalty - actionPenalty;
  if (regime === "BEAR") x -= risk === "HIGH" ? 20 : 5;
  if (regime === "NEUTRAL") x -= risk === "HIGH" ? 10 : 0;
  return Number(clamp(x, 0, 100).toFixed(1));
}

function reason(row, mode, eligible) {
  if (!eligible) {
    if (String(row.action).toUpperCase() === "REDUCE") return "Existing model action is REDUCE.";
    if (String(row.freshness).toUpperCase() === "MISSING" || String(row.freshness).toUpperCase() === "VERY_STALE") return "Fundamental data is too stale for new allocation.";
    if ((num(row.score) ?? 0) < mode.scoreFloor) return `Score is below the ${mode.scoreFloor} regime hurdle.`;
    if (String(row.risk).toUpperCase() === "HIGH") return "High-risk position is restricted by the allocation guardrail.";
    return "Does not clear the current capital-allocation rules.";
  }
  if (mode.label === "BEAR") return "Exceptional quality clears the bear-market hurdle; deployment remains intentionally limited.";
  if (mode.label === "NEUTRAL") return "Strong setup clears the neutral-market hurdle; deploy selectively.";
  return "High-quality setup qualifies under the current market regime.";
}

async function getRegime(origin) {
  const r = await fetch(`${origin}/api/market-regime`, { cache: "no-store" });
  const body = await r.json();
  if (!r.ok || !body?.success) throw new Error(body?.error || "Market regime unavailable.");
  return body;
}

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Authentication required." }, { status: 401 });

    const authClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userResult, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userResult?.user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Invalid session." }, { status: 401 });
    const userId = userResult.user.id;

    const { searchParams } = new URL(request.url);
    const cash = Math.max(0, num(searchParams.get("cash")) ?? 0);
    const origin = new URL(request.url).origin;

    const [regimeBody, h] = await Promise.all([
      getRegime(origin),
      supabase.from("holdings").select("instrument_id,current_value,invested_value,quantity").eq("user_id", userId),
    ]);
    if (h.error) throw new Error(`Holdings query failed: ${h.error.message}`);

    const ids = [...new Set((h.data || []).map(x => x.instrument_id).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, regime: regimeBody.regime, portfolio: { current_value: 0, new_cash: cash, deployable_cash: 0, reserve_cash: cash }, summary: { eligible: 0, skipped: 0, total: 0 }, allocations: [], warnings: ["No stock holdings found."] });

    const [{ data: instruments, error: iErr }, { data: scores, error: sErr }] = await Promise.all([
      supabase.from("instruments").select("id,symbol,company_name,sector").in("id", ids),
      supabase.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at").in("instrument_id", ids),
    ]);
    if (iErr) throw new Error(`Instrument query failed: ${iErr.message}`);
    if (sErr) throw new Error(`AI score query failed: ${sErr.message}`);

    const im = new Map((instruments || []).map(x => [x.id, x]));
    const sm = new Map((scores || []).map(x => [x.instrument_id, x]));
    const positions = new Map();
    for (const row of h.data || []) {
      const p = positions.get(row.instrument_id) || { current_value: 0, invested_value: 0, quantity: 0 };
      p.current_value += Number(row.current_value || 0); p.invested_value += Number(row.invested_value || 0); p.quantity += Number(row.quantity || 0); positions.set(row.instrument_id, p);
    }

    const stockValue = [...positions.values()].reduce((s, p) => s + p.current_value, 0);
    const totalValueAfterCash = stockValue + cash;
    const regime = regimeBody.regime || { label: "NEUTRAL", buy_multiplier: 0.7, position_target_multiplier: 0.85, confidence: 0 };
    const mode = regimeRules(regime.label); mode.label = regime.label;

    const rows = [];
    for (const id of ids) {
      const inst = im.get(id) || {}; const score = sm.get(id) || {}; const b = score.score_breakdown || {}; const f = b.freshness || {}; const pos = positions.get(id) || {};
      const currentWeight = totalValueAfterCash > 0 ? (pos.current_value || 0) / totalValueAfterCash * 100 : 0;
      const risk = String(score.risk_level || "UNKNOWN").toUpperCase();
      const action = String(score.action || "WATCH").toUpperCase();
      const freshness = String(f.status || "MISSING").toUpperCase();
      const confidence = num(b.confidence ?? f.effective_confidence) ?? 0;
      const scoreValue = num(score.total_score);
      const eligible = scoreValue !== null && scoreValue >= mode.scoreFloor && confidence >= (regime.label === "BEAR" ? 85 : 75) && risk !== "HIGH" && action !== "REDUCE" && (!mode.freshRequired || ["FRESH", "ACCEPTABLE"].includes(freshness));
      const base = baseTarget(scoreValue, risk);
      const regimeTarget = base * (num(regime.position_target_multiplier) ?? mode.targetMultiplier);
      const targetWeight = Number(clamp(regimeTarget, 0, riskCap(risk)).toFixed(2));
      const gap = targetWeight - currentWeight;
      const opp = opportunity({ ...score, freshness, confidence, current_weight: currentWeight }, regime.label);
      rows.push({
        id, company_name: inst.company_name || "Unknown", symbol: inst.symbol || "—", sector: inst.sector || "OTHER",
        current_value: Number((pos.current_value || 0).toFixed(2)), current_weight: Number(currentWeight.toFixed(2)),
        score: scoreValue, action, risk, rating: score.rating || "—", confidence: Number(confidence.toFixed(0)), freshness,
        target_weight: targetWeight, gap: Number(gap.toFixed(2)), opportunity_score: opp, eligible,
        reason: reason({ ...score, score: scoreValue, action, risk, freshness }, { ...mode, scoreFloor: mode.scoreFloor }, eligible),
      });
    }

    const eligible = rows.filter(r => r.eligible && r.gap > 0).sort((a, b) => b.opportunity_score - a.opportunity_score);
    const deployableCash = cash * (num(regime.buy_multiplier) ?? mode.deployPct);
    const reserveCash = Math.max(0, cash - deployableCash);
    const sectorCapacity = new Map();
    for (const r of rows) sectorCapacity.set(r.sector, (sectorCapacity.get(r.sector) || 0) + r.current_weight);

    const capacitySum = eligible.reduce((sum, r) => sum + Math.max(0, r.gap) * Math.max(1, r.opportunity_score), 0);
    const allocations = eligible.slice(0, 10).map(r => {
      const share = capacitySum > 0 ? (Math.max(0, r.gap) * Math.max(1, r.opportunity_score)) / capacitySum : 0;
      const recommended = Math.floor(deployableCash * share);
      return { ...r, allocation_pct_of_deployable: Number((share * 100).toFixed(1)), recommended_amount: recommended, post_buy_weight_if_all_in: Number(((r.current_value + recommended) / Math.max(1, totalValueAfterCash) * 100).toFixed(2)) };
    }).filter(r => r.recommended_amount > 0);

    const allocated = allocations.reduce((s, r) => s + r.recommended_amount, 0);
    const warnings = [];
    if (regime.label === "BEAR") warnings.push("Bear regime: only a fraction of new cash is intentionally deployed.");
    if (reserveCash > 0) warnings.push(`Reserve ${Math.round(reserveCash).toLocaleString("en-IN")} of new cash for better conditions or entries.`);
    const highRiskWeight = rows.filter(r => r.risk === "HIGH").reduce((s, r) => s + r.current_weight, 0);
    if (highRiskWeight > 20) warnings.push(`HIGH-risk holdings already represent ${highRiskWeight.toFixed(1)}% of the portfolio.`);

    return NextResponse.json({
      success: true, engine_version: ENGINE_VERSION,
      regime: { label: regime.label, score: regime.score, confidence: regime.confidence, portfolio_mode: regime.portfolio_mode, buy_multiplier: regime.buy_multiplier, position_target_multiplier: regime.position_target_multiplier, guidance: regime.guidance },
      portfolio: { current_stock_value: stockValue, new_cash: cash, total_value_after_cash: totalValueAfterCash, deployable_cash: Number(deployableCash.toFixed(0)), reserve_cash: Number(reserveCash.toFixed(0)), allocated_cash: allocated, unallocated_deployable: Number(Math.max(0, deployableCash - allocated).toFixed(0)) },
      summary: { eligible: allocations.length, skipped: rows.filter(r => !r.eligible).length, total: rows.length },
      allocations,
      ranking: rows.sort((a, b) => b.opportunity_score - a.opportunity_score),
      warnings,
      methodology: { score_floor: mode.scoreFloor, bear_deployment: 0.35, neutral_deployment: 0.7, bull_deployment: 1, risk_caps: { low: 10, moderate: 7, high: 4 }, note: "Regime-aware allocation is a heuristic decision aid, not an automatic trade order." },
    });
  } catch (error) {
    console.error("Regime-aware allocation error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Regime-aware allocation failed." }, { status: 500 });
  }
}
