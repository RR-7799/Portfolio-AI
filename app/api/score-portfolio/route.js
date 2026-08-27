import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing."
    );
  }

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing."
    );
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


// ======================================================
// AI SCORE CALCULATION
// ======================================================

function calculateScore(f) {
  const salesGrowth =
    Number(f.sales_growth ?? 0);

  const profitGrowth =
    Number(f.profit_growth ?? 0);

  const roe =
    Number(f.roe ?? 0);

  const roce =
    Number(f.roce ?? 0);

  const debtToEquity =
    Number(f.debt_to_equity ?? 0);

  const promoter =
    Number(f.promoter_holding ?? 0);

  const fii =
    Number(f.fii_holding ?? 0);

  const dii =
    Number(f.dii_holding ?? 0);

  const operatingCashFlow =
    Number(f.operating_cash_flow ?? 0);

  const netProfit =
    Number(f.net_profit ?? 0);

  const pe =
    Number(f.pe_ratio ?? 0);

  const pb =
    Number(f.pb_ratio ?? 0);


  // ====================================================
  // GROWTH / 20
  // ====================================================

  let growthScore = 0;

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


  // ====================================================
  // PROFITABILITY / 20
  // ====================================================

  let profitabilityScore = 0;

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


  // ====================================================
  // DEBT / 10
  // ====================================================

  let debtScore = 0;

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


  // ====================================================
  // OWNERSHIP / 10
  // ====================================================

  let ownershipScore = 0;

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


  // ====================================================
  // CASH FLOW / 10
  // ====================================================

  let cashflowScore = 0;

  if (operatingCashFlow > 0) {
    cashflowScore += 5;
  }

  if (
    operatingCashFlow > 0 &&
    netProfit > 0 &&
    operatingCashFlow >= netProfit
  ) {
    cashflowScore += 5;
  }

  cashflowScore =
    Math.min(cashflowScore, 10);


  // ====================================================
  // VALUATION / 15
  // ====================================================

  let valuationScore = 0;

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


  // ====================================================
  // RISK / QUALITY / 15
  // ====================================================

  let riskQualityScore = 0;

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

  if (
    salesGrowth >= 10 &&
    profitGrowth >= 10
  ) {
    riskQualityScore += 5;
  } else if (
    salesGrowth > 0 &&
    profitGrowth > 0
  ) {
    riskQualityScore += 2;
  }

  riskQualityScore =
    Math.min(riskQualityScore, 15);


  // ====================================================
  // TOTAL
  // ====================================================

  const totalScore =
    growthScore +
    profitabilityScore +
    debtScore +
    ownershipScore +
    cashflowScore +
    valuationScore +
    riskQualityScore;


  // ====================================================
  // RATING
  // ====================================================

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


  // ====================================================
  // RISK
  // ====================================================

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


  // ====================================================
  // ACTION
  // ====================================================

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


  // ====================================================
  // SUMMARY
  // ====================================================

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


// ======================================================
// GET /api/score-portfolio
// ======================================================

export async function GET() {
  try {
    const supabase = getSupabase();


    // ==================================================
    // STEP 1 — LOAD HOLDINGS
    // ==================================================

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
      .from("holdings")
      .select(
        `
        id,
        user_id,
        instrument_id,
        quantity,
        invested_value,
        current_value
        `
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
        error: "No holdings found.",
      });
    }


    // ==================================================
    // STEP 2 — UNIQUE INSTRUMENT IDS
    // ==================================================

    const instrumentIds = [
      ...new Set(
        holdings
          .map(
            (holding) =>
              holding.instrument_id
          )
          .filter(Boolean)
      ),
    ];


    // ==================================================
    // STEP 3 — LOAD INSTRUMENTS
    // ==================================================

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
        error:
          instrumentsError.message,
      });
    }


    const instrumentMap =
      new Map(
        (instruments || []).map(
          (instrument) => [
            instrument.id,
            instrument,
          ]
        )
      );


    // ==================================================
    // STEP 4 — LOAD FUNDAMENTALS
    // ==================================================

    const {
      data: fundamentals,
      error: fundamentalsError,
    } = await supabase
      .from("fundamentals")
      .select("*")
      .in(
        "instrument_id",
        instrumentIds
      );

    if (fundamentalsError) {
      return NextResponse.json({
        success: false,
        step: "fundamentals",
        error:
          fundamentalsError.message,
      });
    }


    // ==================================================
    // STEP 5 — FUNDAMENTALS MAP
    // ==================================================

    const fundamentalsMap =
      new Map();

    for (
      const row of fundamentals || []
    ) {
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


    // ==================================================
    // STEP 6 — SCORE STOCKS
    // ==================================================

    const results = [];
    const skipped = [];

    /*
     * Only score each instrument once.
     *
     * This is important because your database
     * currently has UNIQUE(instrument_id).
     */

    const processed =
      new Set();


    for (
      const holding of holdings
    ) {

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


      // Avoid duplicate scoring
      if (
        processed.has(
          instrument.id
        )
      ) {
        continue;
      }

      processed.add(
        instrument.id
      );


      const fundamental =
        fundamentalsMap.get(
          instrument.id
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


      // Calculate
      const score =
        calculateScore(
          fundamental
        );


      // ==================================================
      // SAVE
      // ==================================================

      const record = {

        /*
         * We use the first holding's user_id.
         * Your current ai_scores table is instrument-based.
         */
        user_id:
          holding.user_id || null,

        instrument_id:
          instrument.id,

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


      /*
       * IMPORTANT:
       *
       * Your database has:
       *
       * UNIQUE(instrument_id)
       *
       * Therefore the conflict target is ONLY:
       *
       * instrument_id
       */

      const {
        data: saved,
        error: saveError,
      } = await supabase
        .from("ai_scores")
        .upsert(
          record,
          {
            onConflict:
              "instrument_id",
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


    // ==================================================
    // STEP 7 — PORTFOLIO SUMMARY
    // ==================================================

    const scores =
      results.map(
        (item) =>
          Number(item.score)
      );


    const averageScore =
      scores.length > 0
        ? Math.round(
            scores.reduce(
              (a, b) =>
                a + b,
              0
            ) /
              scores.length
          )
        : null;


    const actionCounts = {};


    for (
      const item of results
    ) {

      actionCounts[
        item.action
      ] =
        (
          actionCounts[
            item.action
          ] || 0
        ) + 1;
    }


    // ==================================================
    // FINAL RESPONSE
    // ==================================================

    return NextResponse.json({

      success: true,

      message:
        "Portfolio AI scoring completed successfully.",

      summary: {

        total_holdings:
          holdings.length,

        unique_stocks:
          instrumentIds.length,

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
      "score-portfolio error:",
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
