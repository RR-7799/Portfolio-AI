import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  }

  if (!supabaseKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function calculateScore(fundamentals) {
  let growthScore = 0;
  let profitabilityScore = 0;
  let debtScore = 0;
  let ownershipScore = 0;
  let cashflowScore = 0;
  let valuationScore = 0;
  let riskQualityScore = 0;

  const salesGrowth =
    Number(fundamentals.sales_growth ?? 0);

  const profitGrowth =
    Number(fundamentals.profit_growth ?? 0);

  const roe =
    Number(fundamentals.roe ?? 0);

  const roce =
    Number(fundamentals.roce ?? 0);

  const debtToEquity =
    Number(fundamentals.debt_to_equity ?? 0);

  const promoter =
    Number(fundamentals.promoter_holding ?? 0);

  const fii =
    Number(fundamentals.fii_holding ?? 0);

  const dii =
    Number(fundamentals.dii_holding ?? 0);

  const operatingCashFlow =
    Number(fundamentals.operating_cash_flow ?? 0);

  const pe =
    Number(fundamentals.pe_ratio ?? 0);

  const pb =
    Number(fundamentals.pb_ratio ?? 0);

  // ==========================================
  // GROWTH — 20 POINTS
  // ==========================================

  if (salesGrowth >= 20) {
    growthScore += 10;
  } else if (salesGrowth >= 15) {
    growthScore += 8;
  } else if (salesGrowth >= 10) {
    growthScore += 6;
  } else if (salesGrowth >= 5) {
    growthScore += 3;
  }

  if (profitGrowth >= 20) {
    growthScore += 10;
  } else if (profitGrowth >= 15) {
    growthScore += 8;
  } else if (profitGrowth >= 10) {
    growthScore += 6;
  } else if (profitGrowth >= 5) {
    growthScore += 3;
  }

  // ==========================================
  // PROFITABILITY — 20 POINTS
  // ==========================================

  if (roe >= 20) {
    profitabilityScore += 10;
  } else if (roe >= 15) {
    profitabilityScore += 8;
  } else if (roe >= 10) {
    profitabilityScore += 5;
  } else if (roe > 0) {
    profitabilityScore += 2;
  }

  if (roce >= 20) {
    profitabilityScore += 10;
  } else if (roce >= 15) {
    profitabilityScore += 8;
  } else if (roce >= 10) {
    profitabilityScore += 5;
  } else if (roce > 0) {
    profitabilityScore += 2;
  }

  // ==========================================
  // DEBT — 10 POINTS
  // ==========================================

  if (debtToEquity <= 0) {
    debtScore = 10;
  } else if (debtToEquity <= 0.25) {
    debtScore = 8;
  } else if (debtToEquity <= 0.5) {
    debtScore = 6;
  } else if (debtToEquity <= 1) {
    debtScore = 3;
  } else {
    debtScore = 0;
  }

  // ==========================================
  // OWNERSHIP — 10 POINTS
  // ==========================================

  if (promoter >= 55) {
    ownershipScore += 5;
  } else if (promoter >= 50) {
    ownershipScore += 4;
  } else if (promoter >= 40) {
    ownershipScore += 3;
  } else if (promoter > 0) {
    ownershipScore += 1;
  }

  if (fii >= 15) {
    ownershipScore += 3;
  } else if (fii >= 5) {
    ownershipScore += 2;
  } else if (fii > 0) {
    ownershipScore += 1;
  }

  if (dii >= 10) {
    ownershipScore += 2;
  } else if (dii >= 5) {
    ownershipScore += 1;
  }

  ownershipScore =
    Math.min(ownershipScore, 10);

  // ==========================================
  // CASH FLOW — 10 POINTS
  // ==========================================

  if (operatingCashFlow > 0) {
    cashflowScore = 5;
  }

  if (
    operatingCashFlow >
    Number(fundamentals.net_profit || 0)
  ) {
    cashflowScore += 5;
  }

  cashflowScore =
    Math.min(cashflowScore, 10);

  // ==========================================
  // VALUATION — 15 POINTS
  // ==========================================

  if (pe > 0) {
    if (pe <= 15) {
      valuationScore += 10;
    } else if (pe <= 25) {
      valuationScore += 8;
    } else if (pe <= 35) {
      valuationScore += 5;
    } else if (pe <= 50) {
      valuationScore += 2;
    }
  }

  if (pb > 0) {
    if (pb <= 2) {
      valuationScore += 5;
    } else if (pb <= 4) {
      valuationScore += 4;
    } else if (pb <= 7) {
      valuationScore += 2;
    }
  }

  valuationScore =
    Math.min(valuationScore, 15);

  // ==========================================
  // RISK / QUALITY — 15 POINTS
  // ==========================================

  if (debtToEquity <= 0.5) {
    riskQualityScore += 5;
  } else if (debtToEquity <= 1) {
    riskQualityScore += 3;
  }

  if (roe >= 15 && roce >= 15) {
    riskQualityScore += 5;
  } else if (roe >= 10 && roce >= 10) {
    riskQualityScore += 3;
  }

  if (salesGrowth >= 10 && profitGrowth >= 10) {
    riskQualityScore += 5;
  } else if (
    salesGrowth > 0 &&
    profitGrowth > 0
  ) {
    riskQualityScore += 2;
  }

  riskQualityScore =
    Math.min(riskQualityScore, 15);

  // ==========================================
  // TOTAL
  // ==========================================

  const totalScore =
    growthScore +
    profitabilityScore +
    debtScore +
    ownershipScore +
    cashflowScore +
    valuationScore +
    riskQualityScore;

  let rating;

  if (totalScore >= 85) {
    rating = "EXCELLENT";
  } else if (totalScore >= 70) {
    rating = "GOOD";
  } else if (totalScore >= 55) {
    rating = "AVERAGE";
  } else {
    rating = "WEAK";
  }

  let riskLevel;

  if (
    debtToEquity <= 0.5 &&
    roe >= 15 &&
    roce >= 15
  ) {
    riskLevel = "LOW";
  } else if (
    debtToEquity <= 1
  ) {
    riskLevel = "MODERATE";
  } else {
    riskLevel = "HIGH";
  }

  let action;

  if (totalScore >= 85) {
    action = "BUY";
  } else if (totalScore >= 70) {
    action = "HOLD";
  } else if (totalScore >= 55) {
    action = "WATCH";
  } else {
    action = "REDUCE";
  }

  const aiSummary =
    `Portfolio AI Score: ${totalScore}/100. ` +
    `Rating: ${rating}. ` +
    `Action: ${action}. ` +
    `Growth ${growthScore}/20, ` +
    `Profitability ${profitabilityScore}/20, ` +
    `Debt ${debtScore}/10, ` +
    `Ownership ${ownershipScore}/10, ` +
    `Cash Flow ${cashflowScore}/10, ` +
    `Valuation ${valuationScore}/15, ` +
    `Risk/Quality ${riskQualityScore}/15.`;

  return {
    totalScore,
    growthScore,
    profitabilityScore,
    debtScore,
    ownershipScore,
    cashflowScore,
    valuationScore,
    riskQualityScore,
    riskLevel,
    rating,
    action,
    aiSummary,
  };
}

export async function GET() {
  try {
    const supabase = getSupabase();

    // ==========================================
    // 1. GET ALL STOCK HOLDINGS
    // ==========================================

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
      .from("holdings")
      .select(
        "id, user_id, instrument_id, quantity, invested_value, current_value"
      );

    if (holdingsError) {
      return NextResponse.json({
        success: false,
        step: "holdings",
        error: holdingsError.message,
      });
    }

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({
        success: false,
        step: "holdings",
        error: "No stock holdings found.",
      });
    }

    // ==========================================
    // 2. GET INSTRUMENTS
    // ==========================================

    const instrumentIds = [
      ...new Set(
        holdings
          .map((h) => h.instrument_id)
          .filter(Boolean)
      ),
    ];

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name"
      )
      .in("id", instrumentIds);

    if (instrumentsError) {
      return NextResponse.json({
        success: false,
        step: "instruments",
        error: instrumentsError.message,
      });
    }

    const instrumentMap = new Map(
      (instruments || []).map((i) => [
        i.id,
        i,
      ])
    );

    // ==========================================
    // 3. GET FUNDAMENTALS
    // ==========================================

    const {
      data: fundamentals,
      error: fundamentalsError,
    } = await supabase
      .from("fundamentals")
      .select("*")
      .in("instrument_id", instrumentIds);

    if (fundamentalsError) {
      return NextResponse.json({
        success: false,
        step: "fundamentals",
        error: fundamentalsError.message,
      });
    }

    const fundamentalsMap = new Map();

    for (const row of fundamentals || []) {
      const existing =
        fundamentalsMap.get(
          row.instrument_id
        );

      if (
        !existing ||
        new Date(
          row.updated_at || 0
        ) >
          new Date(
            existing.updated_at || 0
          )
      ) {
        fundamentalsMap.set(
          row.instrument_id,
          row
        );
      }
    }

    // ==========================================
    // 4. SCORE EACH HOLDING
    // ==========================================

    const results = [];
    const skipped = [];

    for (const holding of holdings) {
      const instrument =
        instrumentMap.get(
          holding.instrument_id
        );

      if (!instrument) {
        skipped.push({
          instrument_id:
            holding.instrument_id,
          reason:
            "Instrument not found.",
        });

        continue;
      }

      const fundamental =
        fundamentalsMap.get(
          holding.instrument_id
        );

      if (!fundamental) {
        skipped.push({
          symbol:
            instrument.symbol,
          company_name:
            instrument.company_name,
          reason:
            "Fundamentals not available.",
        });

        continue;
      }

      const score =
        calculateScore(
          fundamental
        );

      // ========================================
      // 5. SAVE SCORE
      // ========================================

      const record = {
        user_id:
          holding.user_id || null,

        instrument_id:
          holding.instrument_id,

        total_score:
          score.totalScore,

        growth_score:
          score.growthScore,

        profitability_score:
          score.profitabilityScore,

        debt_score:
          score.debtScore,

        ownership_score:
          score.ownershipScore,

        cashflow_score:
          score.cashflowScore,

        valuation_score:
          score.valuationScore,

        risk_score:
          score.riskQualityScore,

        risk_level:
          score.riskLevel,

        rating:
          score.rating,

        action:
          score.action,

        ai_summary:
          score.aiSummary,

        calculated_at:
          new Date().toISOString(),

        score_date:
          new Date().toISOString(),
      };

      const {
        data: saved,
        error: saveError,
      } = await supabase
        .from("ai_scores")
        .upsert(
          record,
          {
            onConflict:
              "instrument_id,user_id",
          }
        )
        .select()
        .single();

      if (saveError) {
        skipped.push({
          symbol:
            instrument.symbol,
          company_name:
            instrument.company_name,
          reason:
            saveError.message,
        });

        continue;
      }

      results.push({
        symbol:
          instrument.symbol,

        company_name:
          instrument.company_name,

        instrument_id:
          instrument.id,

        score:
          score.totalScore,

        rating:
          score.rating,

        risk_level:
          score.riskLevel,

        action:
          score.action,

        saved_id:
          saved?.id || null,
      });
    }

    // ==========================================
    // 6. PORTFOLIO SUMMARY
    // ==========================================

    const scores =
      results.map((x) =>
        Number(x.score)
      );

    const averageScore =
      scores.length > 0
        ? Math.round(
            scores.reduce(
              (a, b) => a + b,
              0
            ) / scores.length
          )
        : null;

    const actionCounts = {};

    for (const item of results) {
      actionCounts[item.action] =
        (actionCounts[item.action] || 0) +
        1;
    }

    return NextResponse.json({
      success: true,

      message:
        "Portfolio AI scoring completed.",

      summary: {
        total_holdings:
          holdings.length,

        scored:
          results.length,

        skipped:
          skipped.length,

        average_score:
          averageScore,

        actions:
          actionCounts,
      },

      results,

      skipped,
    });
  } catch (error) {
    console.error(
      "Portfolio scoring error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        step: "server",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
