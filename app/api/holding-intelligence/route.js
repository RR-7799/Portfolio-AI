import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "holding_intelligence_v1_0";
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function userClient(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

function evidenceFromBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return [];
  const labels = { growth_score: "Growth", profitability_score: "Profitability", debt_score: "Debt", ownership_score: "Ownership", cashflow_score: "Cash flow", valuation_score: "Valuation", risk_score: "Risk" };
  return Object.entries(breakdown)
    .filter(([key, value]) => labels[key] && Number.isFinite(Number(value)))
    .map(([key, value]) => ({ factor: labels[key], score: Number(value) }))
    .sort((a, b) => b.score - a.score);
}

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    const client = userClient(token);
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData?.user) return NextResponse.json({ success: false, error: "Invalid session." }, { status: 401 });

    const instrumentId = new URL(request.url).searchParams.get("instrument_id");
    if (!instrumentId) return NextResponse.json({ success: false, error: "instrument_id is required." }, { status: 400 });

    const [h, i, s, mr] = await Promise.all([
      client.from("holdings").select("instrument_id,current_value,invested_value,pnl_percentage,unrealized_pnl").eq("user_id", authData.user.id).eq("instrument_id", instrumentId).maybeSingle(),
      client.from("instruments").select("id,company_name,symbol,sector").eq("id", instrumentId).maybeSingle(),
      client.from("ai_scores").select("instrument_id,total_score,growth_score,profitability_score,debt_score,ownership_score,cashflow_score,valuation_score,risk_score,risk_level,rating,action,ai_summary,score_breakdown,score_date,calculated_at,updated_at").eq("instrument_id", instrumentId).maybeSingle(),
      client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    for (const x of [h, i, s, mr]) if (x.error) throw new Error(x.error.message);
    if (!h.data) return NextResponse.json({ success: false, error: "Holding not found." }, { status: 404 });

    const holding = h.data;
    const score = s.data || {};
    const totalValue = n(holding.current_value);
    const pnl = holding.pnl_percentage ?? (n(holding.invested_value) > 0 ? n(holding.unrealized_pnl) / n(holding.invested_value) * 100 : 0);
    const breakdown = score.score_breakdown || {};
    const evidence = evidenceFromBreakdown(breakdown);
    const freshness = breakdown.freshness?.status || "MISSING";

    const strengths = evidence.filter(x => x.score >= 75).slice(0, 4);
    const weaknesses = evidence.filter(x => x.score < 60).slice(-4).reverse();
    const invalidation = [];
    if (score.total_score != null) invalidation.push(`AI score falls below ${score.total_score >= 75 ? 75 : 60}.`);
    if (score.risk_level === "HIGH" || score.risk_level === "CRITICAL") invalidation.push("Risk remains elevated or deteriorates further.");
    if (freshness === "STALE" || freshness === "VERY_STALE" || freshness === "MISSING") invalidation.push("Fundamental data becomes too stale for conviction.");
    if (n(totalValue) > 0) invalidation.push("Portfolio concentration becomes excessive.");

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      generated_at: new Date().toISOString(),
      instrument: i.data || { id: instrumentId },
      holding: { ...holding, pnl_pct: Number(n(pnl).toFixed(2)) },
      score: { ...score, freshness_status: freshness },
      evidence,
      strengths,
      weaknesses,
      invalidation_checks: invalidation,
      market_regime: mr.data || null
    });
  } catch (error) {
    console.error("Holding intelligence error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Holding intelligence failed." }, { status: 500 });
  }
}
