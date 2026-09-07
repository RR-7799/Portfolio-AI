import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_allocation_v2_2";
const SCORE_VERSION = "ai_scorer_v5_5";
const clientFor = (token) => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const up = (v) => String(v || "").toUpperCase();
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));

function thesisDecision(score) {
  const lt = n(score.long_term_score);
  const confidence = n(score.confidence);
  const completeness = n(score.data_completeness);
  const freshness = up(score.freshness_status);
  const risk = n(score.risk_score);
  if (lt == null || confidence == null || confidence < 60 || completeness == null || completeness < 60 || !freshness || ["MISSING", "STALE", "VERY_STALE"].includes(freshness)) return "WATCH";
  if (risk != null && risk < 25) return "EXIT";
  if (lt < 50) return "EXIT";
  if (lt < 70) return "REDUCE";
  if (lt < 80) return "HOLD";
  return "BUY";
}

function riskFactor(risk) {
  switch (up(risk)) {
    case "LOW": return 1;
    case "LOW-MODERATE": return 0.92;
    case "MODERATE": return 0.85;
    case "HIGH": return 0.65;
    case "VERY HIGH": return 0.45;
    case "CRITICAL": return 0.2;
    default: return 0.75;
  }
}

function buildAllocation(rows, regime) {
  const maxWeight = up(regime) === "BEAR" ? 10 : 15;
  const candidates = rows.map(row => {
    const lt = n(row.long_term_score);
    const decision = row.decision;
    const riskMultiplier = riskFactor(row.risk_level);
    const conviction = lt == null ? 0 : clamp(lt) * riskMultiplier;
    const decisionMultiplier = decision === "BUY" ? 1.15 : decision === "HOLD" ? 1 : decision === "REDUCE" ? 0.45 : 0;
    return { ...row, conviction, raw_weight: conviction * decisionMultiplier };
  });

  const eligible = candidates.filter(x => !["EXIT", "WATCH"].includes(x.decision) && x.raw_weight > 0);
  const rawTotal = eligible.reduce((sum, x) => sum + x.raw_weight, 0);
  const preliminary = candidates.map(x => ({
    ...x,
    target_weight_pct: ["EXIT", "WATCH"].includes(x.decision) || rawTotal <= 0 ? 0 : clamp((x.raw_weight / rawTotal) * 100, 0, maxWeight)
  }));

  for (let pass = 0; pass < 6; pass++) {
    const total = preliminary.reduce((sum, x) => sum + x.target_weight_pct, 0);
    const remaining = 100 - total;
    if (remaining <= 0.05) break;
    const open = preliminary.filter(x => !["EXIT", "WATCH"].includes(x.decision) && x.target_weight_pct < maxWeight - 0.01 && x.raw_weight > 0);
    const openRaw = open.reduce((sum, x) => sum + x.raw_weight, 0);
    if (!open.length || openRaw <= 0) break;
    for (const x of open) x.target_weight_pct = clamp(x.target_weight_pct + remaining * (x.raw_weight / openRaw), 0, maxWeight);
  }

  return preliminary.map(x => {
    // A HOLD or REDUCE thesis may never be assigned a target above current exposure.
    if (x.decision !== "BUY" && x.decision !== "EXIT" && x.decision !== "WATCH") {
      x.target_weight_pct = Math.min(x.target_weight_pct, x.current_weight_pct);
    }
    const delta = x.target_weight_pct - x.current_weight_pct;
    let direction = "HOLD";
    if (x.decision === "EXIT") direction = "TRIM";
    else if (x.decision === "BUY" && delta > 0.5) direction = "ADD";
    else if (x.decision === "REDUCE" && delta < -0.5) direction = "TRIM";
    else if (x.decision === "HOLD" && delta < -0.5) direction = "TRIM";
    else if (x.decision === "WATCH") direction = delta < -0.5 ? "TRIM" : "HOLD";

    let priority = "LOW";
    if (x.decision === "EXIT") priority = "URGENT";
    else if (x.decision === "BUY" || Math.abs(delta) >= 4) priority = "HIGH";
    else if (x.decision === "REDUCE" || Math.abs(delta) >= 2) priority = "MEDIUM";

    const reason = x.decision === "EXIT"
      ? "Exit because the V5.5 Long-Term thesis is impaired or risk is severe."
      : x.decision === "REDUCE"
        ? "Reduce because the V5.5 Long-Term score is below the core-holding threshold."
        : x.decision === "WATCH"
          ? "Do not allocate new capital until V5.5 evidence is sufficiently reliable."
          : direction === "ADD"
            ? `Increase toward ${x.target_weight_pct.toFixed(1)}% based primarily on the V5.5 Long-Term thesis and adjusted for risk.`
            : direction === "TRIM"
              ? `Reduce toward ${x.target_weight_pct.toFixed(1)}% because current exposure exceeds the V5.5 thesis/risk target.`
              : "Current exposure is broadly aligned with the V5.5 thesis/risk target.";

    return {
      instrument_id: x.instrument_id,
      company_name: x.company_name,
      symbol: x.symbol,
      sector: x.sector,
      decision: x.decision,
      risk_level: x.risk_level,
      ai_score: x.final_ai_score,
      final_ai_score: x.final_ai_score,
      long_term_score: x.long_term_score,
      short_term_score: x.short_term_score,
      risk_score: x.risk_score,
      valuation_score: x.valuation_score,
      confidence: x.confidence,
      data_completeness: x.data_completeness,
      freshness_status: x.freshness_status,
      score_version: SCORE_VERSION,
      current_weight_pct: +x.current_weight_pct.toFixed(2),
      target_weight_pct: +x.target_weight_pct.toFixed(2),
      change_weight_pct: +delta.toFixed(2),
      direction,
      priority,
      reason,
      allocation_engine_version: ENGINE_VERSION
    };
  });
}

export async function GET(request) {
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Authentication required." }, { status: 401 });
    const client = clientFor(token);
    const { data: userResult, error: userError } = await client.auth.getUser(token);
    if (userError || !userResult?.user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Invalid session." }, { status: 401 });
    const userId = userResult.user.id;

    const [h, i, s, mr] = await Promise.all([
      client.from("holdings").select("instrument_id,current_value").eq("user_id", userId),
      client.from("instruments").select("id,company_name,symbol,sector"),
      client.from("ai_scores").select("instrument_id,final_ai_score,long_term_score,short_term_score,risk_score,valuation_score,risk_level,confidence,data_completeness,freshness_status,score_version").eq("user_id", userId).eq("score_version", SCORE_VERSION),
      client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at", { ascending: false }).limit(1)
    ]);
    for (const x of [h, i, s, mr]) if (x.error) throw new Error(x.error.message);

    const im = new Map((i.data || []).map(x => [x.id, x]));
    const sm = new Map((s.data || []).map(x => [x.instrument_id, x]));
    const total = (h.data || []).reduce((sum, x) => sum + (n(x.current_value) || 0), 0);
    const regime = mr.data?.[0]?.regime || "NEUTRAL";
    const rows = (h.data || []).map(x => {
      const score = sm.get(x.instrument_id) || {};
      const meta = im.get(x.instrument_id) || {};
      return {
        instrument_id: x.instrument_id,
        company_name: meta.company_name || meta.symbol || "Holding",
        symbol: meta.symbol || null,
        sector: meta.sector || "OTHER",
        portfolio_weight_pct: total > 0 ? (n(x.current_value) || 0) / total * 100 : 0,
        current_weight_pct: total > 0 ? (n(x.current_value) || 0) / total * 100 : 0,
        final_ai_score: n(score.final_ai_score),
        long_term_score: n(score.long_term_score),
        short_term_score: n(score.short_term_score),
        risk_score: n(score.risk_score),
        valuation_score: n(score.valuation_score),
        risk_level: score.risk_level || null,
        confidence: n(score.confidence),
        data_completeness: n(score.data_completeness),
        freshness_status: score.freshness_status || null,
        decision: thesisDecision(score)
      };
    });

    const allocations = buildAllocation(rows, regime);
    allocations.sort((a, b) => ({ URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[a.priority] ?? 9) - ({ URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[b.priority] ?? 9) || Math.abs(b.change_weight_pct) - Math.abs(a.change_weight_pct));
    const summary = {
      portfolio_value: total,
      market_regime: regime,
      total_positions: allocations.length,
      add_count: allocations.filter(x => x.direction === "ADD").length,
      trim_count: allocations.filter(x => x.direction === "TRIM").length,
      exit_count: allocations.filter(x => x.decision === "EXIT").length,
      watch_count: allocations.filter(x => x.decision === "WATCH").length,
      high_priority_count: allocations.filter(x => ["URGENT", "HIGH"].includes(x.priority)).length,
      target_weight_total: +allocations.reduce((sum, x) => sum + x.target_weight_pct, 0).toFixed(2)
    };
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, score_version: SCORE_VERSION, generated_at: new Date().toISOString(), summary, allocations });
  } catch (error) {
    console.error("Portfolio allocation error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Portfolio allocation failed." }, { status: 500 });
  }
}
