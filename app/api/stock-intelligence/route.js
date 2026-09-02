import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const instrumentId = searchParams.get("instrument_id");

    if (!instrumentId) {
      return NextResponse.json(
        { success: false, error: "instrument_id is required" },
        { status: 400 }
      );
    }

    const [instrumentResult, fundamentalsResult, scoreResult, holdingResult] = await Promise.all([
      supabase
        .from("instruments")
        .select("id,symbol,company_name,sector")
        .eq("id", instrumentId)
        .maybeSingle(),
      supabase
        .from("fundamentals")
        .select("*")
        .eq("instrument_id", instrumentId)
        .maybeSingle(),
      supabase
        .from("ai_scores")
        .select("*")
        .eq("instrument_id", instrumentId)
        .maybeSingle(),
      supabase
        .from("holdings")
        .select("quantity,average_price,invested_value,current_value,unrealized_pnl,pnl_percentage")
        .eq("instrument_id", instrumentId),
    ]);

    if (instrumentResult.error) throw new Error(`Instrument query failed: ${instrumentResult.error.message}`);
    if (fundamentalsResult.error) throw new Error(`Fundamentals query failed: ${fundamentalsResult.error.message}`);
    if (scoreResult.error) throw new Error(`AI score query failed: ${scoreResult.error.message}`);
    if (holdingResult.error) throw new Error(`Holding query failed: ${holdingResult.error.message}`);

    if (!instrumentResult.data) {
      return NextResponse.json(
        { success: false, error: "Instrument not found" },
        { status: 404 }
      );
    }

    const holdings = holdingResult.data || [];
    const portfolio = holdings.reduce(
      (acc, row) => {
        acc.quantity += Number(row.quantity || 0);
        acc.invested_value += Number(row.invested_value || 0);
        acc.current_value += Number(row.current_value || 0);
        acc.unrealized_pnl += Number(row.unrealized_pnl || 0);
        return acc;
      },
      { quantity: 0, invested_value: 0, current_value: 0, unrealized_pnl: 0 }
    );

    portfolio.pnl_percentage = portfolio.invested_value
      ? (portfolio.unrealized_pnl / portfolio.invested_value) * 100
      : 0;

    const score = scoreResult.data || null;
    const fundamentals = fundamentalsResult.data || null;
    const breakdown = score?.score_breakdown || {};

    const strengths = [];
    const concerns = [];

    const components = score?.score_breakdown?.components || {};
    const raw = score?.score_breakdown?.raw_inputs || {};

    if (Number(components.growth) >= 80) strengths.push("Strong growth profile.");
    if (Number(components.profitability) >= 80) strengths.push("Strong profitability profile.");
    if (Number(components.balance) >= 80) strengths.push("Healthy balance-sheet profile.");
    if (Number(components.cash) >= 80) strengths.push("Strong operating cash-flow profile.");
    if (Number(components.ownership) >= 80) strengths.push("Supportive ownership profile.");
    if (Number(components.valuation) >= 80) strengths.push("Valuation scores favorably under the current model.");

    if (Number(components.growth) < 50) concerns.push("Growth is currently weak or mixed.");
    if (Number(components.profitability) < 50) concerns.push("Profitability is currently weak or mixed.");
    if (Number(components.balance) < 50) concerns.push("Balance-sheet risk is elevated.");
    if (Number(components.cash) < 50) concerns.push("Operating cash-flow quality is weak.");
    if (Number(components.valuation) < 50) concerns.push("Valuation is demanding under the current model.");
    if (score?.risk_level === "HIGH") concerns.push("Overall model risk is HIGH.");
    if (breakdown?.freshness?.status === "MISSING") concerns.push("Financial statement freshness is missing.");
    if (breakdown?.freshness?.status === "VERY_STALE") concerns.push("Financial statement data is very stale.");

    return NextResponse.json({
      success: true,
      engine_version: "stock_intelligence_v1_0",
      instrument: instrumentResult.data,
      portfolio,
      fundamentals,
      ai_score: {
        total_score: score?.total_score ?? null,
        rating: score?.rating ?? null,
        action: score?.action ?? null,
        risk_level: score?.risk_level ?? null,
        updated_at: score?.updated_at ?? score?.calculated_at ?? null,
        breakdown,
        strengths,
        concerns,
      },
      key_metrics: {
        pe: fundamentals?.pe_ratio ?? null,
        pb: fundamentals?.pb_ratio ?? null,
        roe: fundamentals?.roe ?? null,
        roce: fundamentals?.roce ?? null,
        sales_growth: fundamentals?.sales_growth ?? null,
        profit_growth: fundamentals?.profit_growth ?? null,
        debt_to_equity: fundamentals?.debt_to_equity ?? null,
        operating_cash_flow: fundamentals?.operating_cash_flow ?? null,
        promoter_holding: fundamentals?.promoter_holding ?? null,
        fii_holding: fundamentals?.fii_holding ?? null,
        dii_holding: fundamentals?.dii_holding ?? null,
        market_cap: fundamentals?.market_cap ?? null,
        eps: fundamentals?.eps ?? null,
        book_value_per_share: fundamentals?.book_value_per_share ?? null,
        dividend_yield: fundamentals?.dividend_yield ?? null,
        week_52_high: fundamentals?.week_52_high ?? null,
        week_52_low: fundamentals?.week_52_low ?? null,
        financial_year: fundamentals?.financial_year ?? null,
        shareholding_date: fundamentals?.shareholding_date ?? null,
      },
      raw_inputs: raw,
    });
  } catch (error) {
    console.error("Stock intelligence error:", error);
    return NextResponse.json(
      { success: false, engine_version: "stock_intelligence_v1_0", error: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
