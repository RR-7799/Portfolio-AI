import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreGrowth(salesGrowth, profitGrowth) {
  let score = 0;

  // Sales growth: 10 points
  if (salesGrowth >= 20) score += 10;
  else if (salesGrowth >= 15) score += 8;
  else if (salesGrowth >= 10) score += 6;
  else if (salesGrowth >= 5) score += 3;

  // Profit growth: 10 points
  if (profitGrowth >= 20) score += 10;
  else if (profitGrowth >= 15) score += 8;
  else if (profitGrowth >= 10) score += 6;
  else if (profitGrowth >= 5) score += 3;

  return score;
}

function scoreProfitability(roe, roce) {
  let score = 0;

  // ROE: 10 points
  if (roe >= 25) score += 10;
  else if (roe >= 20) score += 8;
  else if (roe >= 15) score += 6;
  else if (roe >= 10) score += 3;

  // ROCE: 10 points
  if (roce >= 25) score += 10;
  else if (roce >= 20) score += 8;
  else if (roce >= 15) score += 6;
  else if (roce >= 10) score += 3;

  return score;
}

function scoreDebt(debtToEquity) {
  if (debtToEquity === null) return 5;

  if (debtToEquity <= 0.1) return 10;
  if (debtToEquity <= 0.3) return 8;
  if (debtToEquity <= 0.5) return 6;
  if (debtToEquity <= 1) return 4;
  if (debtToEquity <= 2) return 2;

  return 0;
}

function scoreOwnership(promoter, fii, dii) {
  let score = 0;

  // Promoter: 5 points
  if (promoter >= 55) score += 5;
  else if (promoter >= 50) score += 4;
  else if (promoter >= 45) score += 3;
  else if (promoter >= 35) score += 2;
  else if (promoter >= 25) score += 1;

  // FII: 2.5 points
  if (fii >= 15) score += 2.5;
  else if (fii >= 10) score += 2;
  else if (fii >= 5) score += 1;
  else if (fii > 0) score += 0.5;

  // DII: 2.5 points
  if (dii >= 15) score += 2.5;
  else if (dii >= 10) score += 2;
  else if (dii >= 5) score += 1;
  else if (dii > 0) score += 0.5;

  return score;
}

function scoreCashFlow(operatingCashFlow, netProfit) {
  if (
    operatingCashFlow === null ||
    netProfit === null
  ) {
    return 5;
  }

  if (operatingCashFlow > 0 && netProfit > 0) {
    const cashConversion =
      operatingCashFlow / netProfit;

    if (cashConversion >= 1) return 10;
    if (cashConversion >= 0.75) return 8;
    if (cashConversion >= 0.5) return 6;
    if (cashConversion > 0) return 4;
  }

  return 0;
}

function scoreValuation(pe, pb) {
  let score = 0;

  // P/E: 8 points
  if (pe === null) {
    score += 4;
  } else if (pe <= 15) {
    score += 8;
  } else if (pe <= 20) {
    score += 7;
  } else if (pe <= 25) {
    score += 6;
  } else if (pe <= 35) {
    score += 4;
  } else if (pe <= 50) {
    score += 2;
  }

  // P/B: 7 points
  if (pb === null) {
    score += 3.5;
  } else if (pb <= 2) {
    score += 7;
  } else if (pb <= 3) {
    score += 6;
  } else if (pb <= 5) {
    score += 4;
  } else if (pb <= 8) {
    score += 2;
  }

  return score;
}

function scoreRisk(
  roe,
  roce,
  debtToEquity,
  pe,
  promoter
) {
  let score = 0;

  // Strong profitability
  if (roe >= 20 && roce >= 20) {
    score += 5;
  } else if (roe >= 15 && roce >= 15) {
    score += 4;
  } else if (roe >= 10 && roce >= 10) {
    score += 2;
  }

  // Low debt
  if (debtToEquity <= 0.3) {
    score += 4;
  } else if (debtToEquity <= 0.75) {
    score += 3;
  } else if (debtToEquity <= 1.5) {
    score += 2;
  }

  // Valuation risk
  if (pe === null) {
    score += 3;
  } else if (pe <= 25) {
    score += 3;
  } else if (pe <= 40) {
    score += 2;
  } else if (pe <= 60) {
    score += 1;
  }

  // Promoter alignment
  if (promoter >= 50) {
    score += 3;
  } else if (promoter >= 40) {
    score += 2;
  } else if (promoter >= 25) {
    score += 1;
  }

  return Math.min(score, 15);
}

function getRiskLevel(score) {
  if (score >= 80) return "LOW";
  if (score >= 65) return "MODERATE";
  if (score >= 50) return "HIGH";

  return "VERY HIGH";
}

function getRating(score) {
  if (score >= 85) return "EXCELLENT";
  if (score >= 75) return "STRONG";
  if (score >= 65) return "GOOD";
  if (score >= 50) return "AVERAGE";

  return "WEAK";
}

function getAction(score, pe) {
  /*
   * This is deliberately conservative.
   * A strong company can still be expensive.
   */

  if (score >= 85) {
    if (pe !== null && pe > 50) {
      return "HOLD / WAIT FOR BETTER VALUATION";
    }

    return "BUY / HOLD";
  }

  if (score >= 75) {
    if (pe !== null && pe > 50) {
      return "HOLD";
    }

    return "BUY / HOLD";
  }

  if (score >= 65) {
    return "HOLD";
  }

  if (score >= 50) {
    return "WATCH";
  }

  return "AVOID";
}

function createSummary(
  score,
  rating,
  action,
  growthScore,
  profitabilityScore,
  debtScore,
  ownershipScore,
  cashflowScore,
  valuationScore,
  riskScore
) {
  return (
    `Portfolio AI Score: ${score}/100. ` +
    `Rating: ${rating}. ` +
    `Action: ${action}. ` +
    `Growth ${growthScore}/20, ` +
    `Profitability ${profitabilityScore}/20, ` +
    `Debt ${debtScore}/10, ` +
    `Ownership ${ownershipScore}/10, ` +
    `Cash Flow ${cashflowScore}/10, ` +
    `Valuation ${valuationScore}/15, ` +
    `Risk/Quality ${riskScore}/15.`
  );
}

export async function GET(request) {
  try {
    // =====================================================
    // 1. ENVIRONMENT
    // =====================================================

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseSecretKey =
      process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl) {
      return NextResponse.json({
        success: false,
        step: "configuration",
        error:
          "NEXT_PUBLIC_SUPABASE_URL is missing",
      });
    }

    if (!supabaseSecretKey) {
      return NextResponse.json({
        success: false,
        step: "configuration",
        error:
          "SUPABASE_SECRET_KEY is missing",
      });
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseSecretKey
    );

    // =====================================================
    // 2. GET SYMBOL
    // =====================================================

    const { searchParams } =
      new URL(request.url);

    const symbol =
      searchParams.get("symbol") ||
      "INE263A01024";

    // =====================================================
    // 3. FIND INSTRUMENT
    // =====================================================

    const {
      data: instruments,
      error: instrumentError,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name"
      )
      .eq("symbol", symbol)
      .limit(1);

    if (instrumentError) {
      return NextResponse.json({
        success: false,
        step: "find_instrument",
        error:
          instrumentError.message,
      });
    }

    if (
      !instruments ||
      instruments.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "find_instrument",
        error:
          `Instrument not found: ${symbol}`,
      });
    }

    const instrument =
      instruments[0];

    // =====================================================
    // 4. GET FUNDAMENTALS
    // =====================================================

    const {
      data: fundamentals,
      error: fundamentalsError,
    } = await supabase
      .from("fundamentals")
      .select("*")
      .eq(
        "instrument_id",
        instrument.id
      )
      .limit(1);

    if (fundamentalsError) {
      return NextResponse.json({
        success: false,
        step: "get_fundamentals",
        error:
          fundamentalsError.message,
      });
    }

    if (
      !fundamentals ||
      fundamentals.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "get_fundamentals",
        error:
          `No fundamentals found for ${instrument.company_name}. Run sync-fundamentals first.`,
      });
    }

    const f =
      fundamentals[0];

    // =====================================================
    // 5. NORMALIZE DATA
    // =====================================================

    const salesGrowth =
      num(f.sales_growth) ?? 0;

    const profitGrowth =
      num(f.profit_growth) ?? 0;

    const roe =
      num(f.roe) ?? 0;

    const roce =
      num(f.roce) ?? 0;

    const debtToEquity =
      num(f.debt_to_equity) ?? 0;

    const promoter =
      num(f.promoter_holding) ?? 0;

    const fii =
      num(f.fii_holding) ?? 0;

    const dii =
      num(f.dii_holding) ?? 0;

    const operatingCashFlow =
      num(f.operating_cash_flow);

    const pe =
      num(f.pe_ratio);

    const pb =
      num(f.pb_ratio);

    // =====================================================
    // 6. GET NET PROFIT FROM FUNDAMENTALS API DATA
    // =====================================================

    /*
     * The current fundamentals table does not store
     * net profit yet.
     *
     * Therefore cash-flow scoring uses a conservative
     * neutral score until net profit is added.
     */

    const netProfit = null;

    // =====================================================
    // 7. CALCULATE CATEGORY SCORES
    // =====================================================

    const growthScore =
      scoreGrowth(
        salesGrowth,
        profitGrowth
      );

    const profitabilityScore =
      scoreProfitability(
        roe,
        roce
      );

    const debtScore =
      scoreDebt(
        debtToEquity
      );

    const ownershipScore =
      scoreOwnership(
        promoter,
        fii,
        dii
      );

    const cashflowScore =
      scoreCashFlow(
        operatingCashFlow,
        netProfit
      );

    const valuationScore =
      scoreValuation(
        pe,
        pb
      );

    const riskScore =
      scoreRisk(
        roe,
        roce,
        debtToEquity,
        pe,
        promoter
      );

    // =====================================================
    // 8. TOTAL SCORE
    // =====================================================

    const totalScore =
      Number(
        (
          growthScore +
          profitabilityScore +
          debtScore +
          ownershipScore +
          cashflowScore +
          valuationScore +
          riskScore
        ).toFixed(2)
      );

    // =====================================================
    // 9. RATING / RISK / ACTION
    // =====================================================

    const rating =
      getRating(totalScore);

    const riskLevel =
      getRiskLevel(totalScore);

    const action =
      getAction(
        totalScore,
        pe
      );

    // =====================================================
    // 10. SUMMARY
    // =====================================================

    const aiSummary =
      createSummary(
        totalScore,
        rating,
        action,
        growthScore,
        profitabilityScore,
        debtScore,
        ownershipScore,
        cashflowScore,
        valuationScore,
        riskScore
      );

    // =====================================================
    // 11. SAVE SCORE
    // =====================================================

    const scoreRecord = {
      instrument_id:
        instrument.id,

      total_score:
        totalScore,

      growth_score:
        growthScore,

      profitability_score:
        profitabilityScore,

      debt_score:
        debtScore,

      ownership_score:
        ownershipScore,

      cashflow_score:
        cashflowScore,

      valuation_score:
        valuationScore,

      risk_level:
        riskLevel,

      rating:
        rating,

      action:
        action,

      ai_summary:
        aiSummary,

      calculated_at:
        new Date().toISOString(),
    };

    const {
      data: savedScore,
      error: saveError,
    } = await supabase
      .from("ai_scores")
      .upsert(
        scoreRecord,
        {
          onConflict:
            "instrument_id",
        }
      )
      .select()
      .single();

    if (saveError) {
      return NextResponse.json({
        success: false,
        step: "save_score",
        error:
          saveError.message,
        record_attempted:
          scoreRecord,
      });
    }

    // =====================================================
    // 12. SUCCESS
    // =====================================================

    return NextResponse.json({
      success: true,

      message:
        `${instrument.company_name} AI score calculated successfully.`,

      stock: {
        symbol:
          instrument.symbol,

        company_name:
          instrument.company_name,

        instrument_id:
          instrument.id,
      },

      score: {
        total:
          totalScore,

        rating:
          rating,

        risk_level:
          riskLevel,

        action:
          action,
      },

      breakdown: {
        growth:
          {
            score:
              growthScore,
            max:
              20,
          },

        profitability:
          {
            score:
              profitabilityScore,
            max:
              20,
          },

        debt:
          {
            score:
              debtScore,
            max:
              10,
          },

        ownership:
          {
            score:
              ownershipScore,
            max:
              10,
          },

        cash_flow:
          {
            score:
              cashflowScore,
            max:
              10,
          },

        valuation:
          {
            score:
              valuationScore,
            max:
              15,
          },

        risk_quality:
          {
            score:
              riskScore,
            max:
              15,
          },
      },

      summary:
        aiSummary,

      saved_to:
        "ai_scores",

      saved_record:
        savedScore,
    });
  } catch (error) {
    console.error(
      "AI score error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        step: "unexpected",
        error:
          error?.message ||
          "Unknown error",
      },
      { status: 500 }
    );
  }
}
