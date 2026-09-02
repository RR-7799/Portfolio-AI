import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as runV41 } from "../score-portfolio-safe/route";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "safe_v4_2";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i);
  if (!match) return null;
  const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const month = monthMap[match[1].slice(0, 3).toLowerCase()];
  const year = Number(match[2]);
  if (!Number.isInteger(year) || month === undefined) return null;
  return new Date(Date.UTC(year, month + 1, 0));
}

function ageInMonths(date, now) {
  if (!date) return null;
  const yearDiff = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  const dayAdjustment = now.getUTCDate() < date.getUTCDate() ? 1 : 0;
  return Math.max(0, yearDiff * 12 + monthDiff - dayAdjustment);
}

function classifyFreshness(ageMonths) {
  if (ageMonths === null) return { status: "MISSING", confidence: 0, maxScore: 49 };
  if (ageMonths <= 12) return { status: "FRESH", confidence: 100, maxScore: 100 };
  if (ageMonths <= 18) return { status: "ACCEPTABLE", confidence: 80, maxScore: 84 };
  if (ageMonths <= 24) return { status: "AGING", confidence: 60, maxScore: 74 };
  if (ageMonths <= 36) return { status: "STALE", confidence: 35, maxScore: 69 };
  return { status: "VERY_STALE", confidence: 15, maxScore: 59 };
}

function recalcRating(score, confidence) {
  if (score === null || score === undefined) return "INSUFFICIENT_DATA";
  if (confidence < 50) return "PROVISIONAL";
  if (score >= 90) return "EXCEPTIONAL";
  if (score >= 80) return "STRONG";
  if (score >= 70) return "GOOD";
  if (score >= 60) return "AVERAGE";
  if (score >= 50) return "WEAK";
  return "POOR";
}

function recalcAction(score, baseAction, freshnessStatus, confidence, risk, valuation) {
  const freshnessBuyEligible = ["FRESH", "ACCEPTABLE"].includes(freshnessStatus);

  if (
    baseAction === "BUY" &&
    score >= 85 &&
    confidence >= 80 &&
    freshnessBuyEligible &&
    valuation !== null &&
    valuation >= 45 &&
    (risk === null || risk >= 55)
  ) {
    return "BUY";
  }

  if (baseAction === "BUY") {
    if (score >= 80) return "WATCH";
    if (score >= 70) return "HOLD";
    if (score >= 60) return "WATCH";
    return "REDUCE";
  }

  return baseAction;
}

function addFreshnessDiagnostics(diagnostics, freshness) {
  const next = [...(diagnostics || [])];
  if (freshness.status === "MISSING") next.push("FINANCIAL_DATA_MISSING");
  else if (freshness.status === "VERY_STALE") next.push("FINANCIAL_DATA_VERY_STALE");
  else if (freshness.status === "STALE") next.push("FINANCIAL_DATA_STALE");
  else if (freshness.status === "AGING") next.push("FINANCIAL_DATA_AGING");
  else if (freshness.status === "ACCEPTABLE") next.push("FINANCIAL_DATA_ACCEPTABLE");

  if (freshness.confidence < 80) next.push("LOW_FRESHNESS");
  return [...new Set(next)];
}

export async function GET() {
  try {
    const baseResponse = await runV41();
    const basePayload = await baseResponse.json();

    if (!basePayload?.success) {
      return NextResponse.json({
        ...basePayload,
        engine_version: ENGINE_VERSION,
        based_on: "safe_v4_1",
      }, { status: baseResponse.status || 500 });
    }

    const now = new Date();
    const baseResults = basePayload.results || [];
    const stockResults = baseResults.filter((item) => item.status !== "SKIPPED_FUND" && item.instrument_id);
    const instrumentIds = [...new Set(stockResults.map((item) => item.instrument_id))];

    const [{ data: fundamentals, error: fundamentalsError }, { data: aiScores, error: aiScoresError }] = await Promise.all([
      instrumentIds.length
        ? supabase.from("fundamentals").select("instrument_id,financial_year,shareholding_date,updated_at").in("instrument_id", instrumentIds)
        : Promise.resolve({ data: [], error: null }),
      instrumentIds.length
        ? supabase.from("ai_scores").select("instrument_id,score_breakdown").in("instrument_id", instrumentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (fundamentalsError) throw new Error(`Fundamentals query failed: ${fundamentalsError.message}`);
    if (aiScoresError) throw new Error(`AI scores query failed: ${aiScoresError.message}`);

    const fundamentalsMap = new Map((fundamentals || []).map((row) => [row.instrument_id, row]));
    const aiScoresMap = new Map((aiScores || []).map((row) => [row.instrument_id, row]));

    const finalResults = baseResults.map((base) => {
      if (base.status === "SKIPPED_FUND" || !base.instrument_id) return base;

      const f = fundamentalsMap.get(base.instrument_id) || {};
      const financialDate = parseDate(f.financial_year);
      const financialAgeMonths = ageInMonths(financialDate, now);
      const freshness = classifyFreshness(financialAgeMonths);
      const baseConfidence = Number(base.confidence ?? 0);
      const effectiveConfidence = Math.min(baseConfidence, freshness.confidence);
      const baseScore = base.total_score ?? null;
      const adjustedScore = baseScore === null ? null : Math.min(baseScore, freshness.maxScore);
      const valuation = base.valuation?.score ?? null;
      const risk = base.risk_level === "HIGH" ? 40 : base.risk_level === "MODERATE" ? 65 : 80;
      const action = recalcAction(adjustedScore, base.action, freshness.status, effectiveConfidence, risk, valuation);
      const rating = recalcRating(adjustedScore, effectiveConfidence);
      const diagnostics = addFreshnessDiagnostics(base.diagnostics, freshness);

      if (base.action === "BUY" && action !== "BUY") diagnostics.push("BUY_BLOCKED_BY_FRESHNESS");

      const existingBreakdown = aiScoresMap.get(base.instrument_id)?.score_breakdown || {};
      const scoreBreakdown = {
        ...existingBreakdown,
        engine: ENGINE_VERSION,
        based_on_engine: "safe_v4_1",
        freshness: {
          financial_period: f.financial_year || null,
          financial_age_months: financialAgeMonths,
          status: freshness.status,
          freshness_confidence: freshness.confidence,
          effective_confidence: effectiveConfidence,
          max_score: freshness.maxScore,
          as_of: now.toISOString(),
        },
        diagnostics,
        notes: [
          ...(existingBreakdown.notes || []),
          `Freshness status: ${freshness.status}.`,
        ],
        rules: {
          ...(existingBreakdown.rules || {}),
          freshness_rule: "Effective confidence is the lower of completeness confidence and financial freshness confidence.",
          freshness_ceiling: "FRESH 100, ACCEPTABLE 84, AGING 74, STALE 69, VERY_STALE 59, MISSING 49.",
          freshness_buy_rule: "BUY requires FRESH or ACCEPTABLE financial data; stale or missing financial data blocks BUY.",
        },
      };

      return {
        ...base,
        status: base.status,
        total_score: adjustedScore,
        rating,
        action,
        confidence: effectiveConfidence,
        diagnostics: [...new Set(diagnostics)],
        freshness_status: freshness.status,
        financial_period: f.financial_year || null,
        financial_age_months: financialAgeMonths,
        freshness_confidence: freshness.confidence,
        freshness_max_score: freshness.maxScore,
        original_v41_score: baseScore,
        original_v41_action: base.action,
        original_v41_confidence: baseConfidence,
        score_breakdown: scoreBreakdown,
      };
    });

    let upserted = 0;
    for (const item of finalResults) {
      if (item.status === "SKIPPED_FUND" || !item.instrument_id || item.total_score === null) continue;
      const { error } = await supabase.from("ai_scores").upsert({
        instrument_id: item.instrument_id,
        total_score: item.total_score,
        rating: item.rating,
        action: item.action,
        risk_level: item.risk_level,
        score_breakdown: item.score_breakdown,
        updated_at: new Date().toISOString(),
      }, { onConflict: "instrument_id" });
      if (error) throw new Error(`AI score upsert failed for ${item.company_name || item.instrument_id}: ${error.message}`);
      upserted++;
    }

    const scored = finalResults.filter((item) => item.total_score !== null && item.total_score !== undefined);
    const actionCounts = {};
    const ratingCounts = {};
    const riskCounts = {};
    const freshnessCounts = {};

    for (const item of finalResults) {
      if (item.action) actionCounts[item.action] = (actionCounts[item.action] || 0) + 1;
      if (item.rating) ratingCounts[item.rating] = (ratingCounts[item.rating] || 0) + 1;
      if (item.risk_level) riskCounts[item.risk_level] = (riskCounts[item.risk_level] || 0) + 1;
      if (item.freshness_status) freshnessCounts[item.freshness_status] = (freshnessCounts[item.freshness_status] || 0) + 1;
    }

    const buyCandidates = finalResults.filter((item) => item.action === "BUY");
    const freshnessBlockedBuys = finalResults.filter((item) => item.original_v41_action === "BUY" && item.action !== "BUY");
    const averageScore = scored.length
      ? Number((scored.reduce((sum, item) => sum + item.total_score, 0) / scored.length).toFixed(2))
      : null;

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      based_on: "safe_v4_1",
      holdings: basePayload.holdings,
      unique_instruments: basePayload.unique_instruments,
      scored: scored.length,
      skipped_funds: basePayload.skipped_funds,
      errors: basePayload.errors,
      upserted,
      average_score: averageScore,
      action_counts: actionCounts,
      rating_counts: ratingCounts,
      risk_counts: riskCounts,
      freshness_counts: freshnessCounts,
      buy_candidates: buyCandidates.length,
      freshness_blocked_buy_count: freshnessBlockedBuys.length,
      freshness_blocked_buy: freshnessBlockedBuys.map((item) => ({
        company_name: item.company_name,
        original_v41_score: item.original_v41_score,
        adjusted_score: item.total_score,
        original_v41_action: item.original_v41_action,
        action: item.action,
        freshness_status: item.freshness_status,
        financial_period: item.financial_period,
        financial_age_months: item.financial_age_months,
      })),
      results: finalResults,
    });
  } catch (error) {
    console.error("Portfolio AI V4.2 error:", error);
    return NextResponse.json({
      success: false,
      engine_version: ENGINE_VERSION,
      error: error?.message || "Unknown error",
    }, { status: 500 });
  }
}
