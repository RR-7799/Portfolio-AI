import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  }

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}


// ======================================================
// BHARATSTOCK HELPER
// ======================================================

async function bharatStockFetch(url) {
  const apiKey =
    process.env.BHARATSTOCK_API_KEY;

  if (!apiKey) {
    throw new Error(
      "BHARATSTOCK_API_KEY is missing."
    );
  }

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
    },
    cache: "no-store",
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  return {
    response,
    data,
    text,
  };
}


// ======================================================
// SYNC ONE STOCK
// ======================================================

async function syncStock(
  supabase,
  instrument
) {
  const symbol =
    String(
      instrument.symbol || ""
    )
      .trim()
      .toUpperCase();

  if (!symbol) {
    return {
      success: false,
      error:
        "Instrument has no symbol.",
    };
  }


  // ----------------------------------------------------
  // FINANCIALS
  // ----------------------------------------------------

  const financialUrl =
    `https://bharatstockapi.com/v1/stocks/${encodeURIComponent(
      symbol
    )}/financials?period_type=annual&page=1&page_size=5`;

  const financial =
    await bharatStockFetch(
      financialUrl
    );

  if (!financial.response.ok) {
    return {
      success: false,
      step: "financials",
      error:
        "BharatStock financials request failed.",
      status:
        financial.response.status,
      response:
        financial.data ||
        financial.text,
    };
  }

  const rows =
    financial.data?.data;

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return {
      success: false,
      step: "financials",
      error:
        "BharatStock returned no annual financial data.",
    };
  }

  const annualRows =
    rows.filter(
      (row) =>
        row.period_type ===
        "annual"
    );

  if (annualRows.length === 0) {
    return {
      success: false,
      step: "financials",
      error:
        "No annual financial records found.",
    };
  }

  const latest =
    annualRows[0];

  const previous =
    annualRows[1] || null;


  // ----------------------------------------------------
  // GROWTH
  // ----------------------------------------------------

  function growth(
    current,
    old
  ) {
    if (
      old === null ||
      old === undefined ||
      Number(old) === 0
    ) {
      return null;
    }

    return Number(
      (
        ((Number(current) -
          Number(old)) /
          Math.abs(
            Number(old)
          )) *
        100
      ).toFixed(2)
    );
  }

  const currentRevenue =
    Number(
      latest.revenue || 0
    );

  const previousRevenue =
    Number(
      previous?.revenue || 0
    );

  const currentProfit =
    Number(
      latest.net_profit_attributable_to_owners ??
      latest.net_profit ??
      0
    );

  const previousProfit =
    Number(
      previous?.net_profit_attributable_to_owners ??
      previous?.net_profit ??
      0
    );

  const salesGrowth =
    previous
      ? growth(
          currentRevenue,
          previousRevenue
        )
      : null;

  const profitGrowth =
    previous
      ? growth(
          currentProfit,
          previousProfit
        )
      : null;


  // ----------------------------------------------------
  // PROFITABILITY
  // ----------------------------------------------------

  const equity =
    Number(
      latest.equity_attributable_to_owners ??
      latest.total_equity ??
      0
    );

  const nonCurrentDebt =
    Number(
      latest.borrowings_non_current ||
        0
    );

  const currentDebt =
    Number(
      latest.borrowings_current ||
        0
    );

  const totalDebt =
    nonCurrentDebt +
    currentDebt;

  const debtToEquity =
    equity > 0
      ? Number(
          (
            totalDebt /
            equity
          ).toFixed(4)
        )
      : null;

  const roe =
    equity > 0
      ? Number(
          (
            (currentProfit /
              equity) *
            100
          ).toFixed(2)
        )
      : null;

  const ebit =
    Number(
      latest.profit_before_tax ||
        0
    ) +
    Number(
      latest.finance_costs ||
        0
    );

  const capital =
    equity + totalDebt;

  const roce =
    capital > 0
      ? Number(
          (
            (ebit /
              capital) *
            100
          ).toFixed(2)
        )
      : null;


  // ----------------------------------------------------
  // CASH FLOW
  // ----------------------------------------------------

  const operatingCashFlow =
    Number(
      latest.cash_flow_operating ||
        0
    );


  // ----------------------------------------------------
  // SHAREHOLDING
  // ----------------------------------------------------

  let promoterHolding = null;
  let fiiHolding = null;
  let diiHolding = null;
  let shareholdingDate = null;

  try {
    const shareUrl =
      `https://bharatstockapi.com/v1/stocks/${encodeURIComponent(
        symbol
      )}/shareholding?page=1&page_size=20`;

    const share =
      await bharatStockFetch(
        shareUrl
      );

    const shareRows =
      share.data?.data;

    if (
      share.response.ok &&
      Array.isArray(shareRows) &&
      shareRows.length > 0
    ) {
      const latestShare =
        shareRows[0];

      promoterHolding =
        latestShare.promoter_pct ??
        null;

      fiiHolding =
        latestShare.fii_pct ??
        null;

      diiHolding =
        latestShare.dii_pct ??
        null;

      shareholdingDate =
        latestShare.as_on_date ??
        null;
    }
  } catch (error) {
    console.error(
      `Shareholding failed for ${symbol}:`,
      error
    );
  }


  // ----------------------------------------------------
  // VALUATION
  // ----------------------------------------------------

  let marketCap = null;
  let peRatio = null;
  let pbRatio = null;
  let bookValuePerShare = null;
  let eps = null;
  let dividendYield = null;
  let week52High = null;
  let week52Low = null;
  let valuationDate = null;

  try {
    const valuationUrl =
      `https://bharatstockapi.com/v1/stocks/${encodeURIComponent(
        symbol
      )}/ratios`;

    const valuation =
      await bharatStockFetch(
        valuationUrl
      );

    if (
      valuation.response.ok &&
      valuation.data?.data
    ) {
      const v =
        valuation.data.data;

      valuationDate =
        v.as_of_date ?? null;

      marketCap =
        v.market_cap ?? null;

      peRatio =
        v.pe_ratio ?? null;

      pbRatio =
        v.pb_ratio ?? null;

      bookValuePerShare =
        v.book_value_per_share ??
        null;

      eps =
        v.eps ?? null;

      dividendYield =
        v.dividend_yield ?? null;

      week52High =
        v.week_52_high ?? null;

      week52Low =
        v.week_52_low ?? null;
    }
  } catch (error) {
    console.error(
      `Valuation failed for ${symbol}:`,
      error
    );
  }


  // ----------------------------------------------------
  // SAVE FUNDAMENTALS
  // ----------------------------------------------------

  const record = {
    instrument_id:
      instrument.id,

    sales_growth:
      salesGrowth,

    profit_growth:
      profitGrowth,

    roe,

    roce,

    debt_to_equity:
      debtToEquity,

    promoter_holding:
      promoterHolding,

    promoter_pledge:
      null,

    fii_holding:
      fiiHolding,

    dii_holding:
      diiHolding,

    operating_cash_flow:
      operatingCashFlow,

    free_cash_flow:
      null,

    financial_year:
      latest.fiscal_year ||
      null,

    quarter:
      null,

    source:
      "BharatStock",

    updated_at:
      new Date().toISOString(),

    market_cap:
      marketCap,

    pe_ratio:
      peRatio,

    pb_ratio:
      pbRatio,

    book_value_per_share:
      bookValuePerShare,

    eps,

    dividend_yield:
      dividendYield,

    week_52_high:
      week52High,

    week_52_low:
      week52Low,

    shareholding_date:
      shareholdingDate,
  };


  const {
    data: saved,
    error: saveError,
  } = await supabase
    .from("fundamentals")
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
    return {
      success: false,
      step:
        "save_fundamentals",
      error:
        saveError.message,
    };
  }


  return {
    success: true,

    financialYear:
      latest.fiscal_year ||
      null,

    salesGrowth,
    profitGrowth,
    roe,
    roce,
    debtToEquity,
    operatingCashFlow,

    promoterHolding,
    fiiHolding,
    diiHolding,

    marketCap,
    peRatio,
    pbRatio,

    savedId:
      saved?.id || null,
  };
}


// ======================================================
// SCORE ENGINE
// ======================================================

function calculateScore(f) {

  const salesGrowth =
    Number(
      f.sales_growth ?? 0
    );

  const profitGrowth =
    Number(
      f.profit_growth ?? 0
    );

  const roe =
    Number(
      f.roe ?? 0
    );

  const roce =
    Number(
      f.roce ?? 0
    );

  const debtToEquity =
    Number(
      f.debt_to_equity ?? 0
    );

  const promoter =
    Number(
      f.promoter_holding ?? 0
    );

  const fii =
    Number(
      f.fii_holding ?? 0
    );

  const dii =
    Number(
      f.dii_holding ?? 0
    );

  const operatingCashFlow =
    Number(
      f.operating_cash_flow ?? 0
    );

  const netProfit =
    Number(
      f.net_profit ?? 0
    );

  const pe =
    Number(
      f.pe_ratio ?? 0
    );

  const pb =
    Number(
      f.pb_ratio ?? 0
    );


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
    Math.min(
      ownershipScore,
      10
    );


  // ====================================================
  // CASH FLOW / 10
  // ====================================================

  let cashflowScore = 0;

  if (operatingCashFlow > 0) {
    cashflowScore += 5;
  }

  /*
   * IMPORTANT:
   *
   * fundamentals currently does not
   * necessarily contain net_profit.
   *
   * Therefore we don't award the second
   * 5 points unless we can actually
   * verify cash flow against profit.
   */

  if (
    f.net_profit !== null &&
    f.net_profit !== undefined &&
    Number(f.net_profit) > 0 &&
    operatingCashFlow >=
      Number(f.net_profit)
  ) {
    cashflowScore += 5;
  }

  cashflowScore =
    Math.min(
      cashflowScore,
      10
    );


  // ====================================================
  // VALUATION / 15
  // ====================================================

  let valuationScore = 0;

  /*
   * Missing valuation = 0 points.
   *
   * We NEVER assume a stock is cheap
   * when valuation data is unavailable.
   */

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
    Math.min(
      valuationScore,
      15
    );


  // ====================================================
  // RISK / QUALITY / 15
  // ====================================================

  let riskQualityScore = 0;

  if (debtToEquity <= 0.5) {
    riskQualityScore += 5;
  } else if (debtToEquity <= 1) {
    riskQualityScore += 3;
  }

  if (
    roe >= 15 &&
    roce >= 15
  ) {
    riskQualityScore += 5;
  } else if (
    roe >= 10 &&
    roce >= 10
  ) {
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
    Math.min(
      riskQualityScore,
      15
    );


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

    const supabase =
      getSupabase();


    // ==================================================
    // 1. LOAD ALL HOLDINGS
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
        instrument_id
        `
      );


    if (holdingsError) {
      return NextResponse.json({
        success: false,
        step: "holdings",
        error:
          holdingsError.message,
      });
    }


    if (
      !holdings ||
      holdings.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "holdings",
        error:
          "No stock holdings found.",
      });
    }


    // ==================================================
    // 2. UNIQUE INSTRUMENTS
    // ==================================================

    const instrumentIds =
      [
        ...new Set(
          holdings
            .map(
              (h) =>
                h.instrument_id
            )
            .filter(Boolean)
        ),
      ];


    // ==================================================
    // 3. LOAD INSTRUMENTS
    // ==================================================

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name"
      )
      .in(
        "id",
        instrumentIds
      );


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
        (instruments || [])
          .map(
            (item) => [
              item.id,
              item,
            ]
          )
      );


    // ==================================================
    // 4. LOAD EXISTING FUNDAMENTALS
    // ==================================================

    const {
      data: existingFundamentals,
      error:
        fundamentalsError,
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


    const fundamentalsMap =
      new Map();


    for (
      const row of
        existingFundamentals || []
    ) {

      const current =
        fundamentalsMap.get(
          row.instrument_id
        );


      if (
        !current ||
        new Date(
          row.updated_at || 0
        ) >
          new Date(
            current.updated_at || 0
          )
      ) {

        fundamentalsMap.set(
          row.instrument_id,
          row
        );
      }
    }


    // ==================================================
    // 5. PROCESS STOCKS
    // ==================================================

    const results = [];
    const skipped = [];
    const synced = [];

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


      // ----------------------------------------------
      // Avoid duplicate instruments
      // ----------------------------------------------

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


      // ----------------------------------------------
      // GET FUNDAMENTALS
      // ----------------------------------------------

      let fundamental =
        fundamentalsMap.get(
          instrument.id
        );


      // ----------------------------------------------
      // MISSING → SYNC BHARATSTOCK
      // ----------------------------------------------

      if (!fundamental) {

        try {

          const sync =
            await syncStock(
              supabase,
              instrument
            );


          if (!sync.success) {

            skipped.push({
              symbol:
                instrument.symbol,

              company_name:
                instrument.company_name,

              reason:
                sync.error ||
                "Unable to sync fundamentals.",

              step:
                sync.step ||
                "sync",
            });

            continue;
          }


          synced.push({
            symbol:
              instrument.symbol,

            company_name:
              instrument.company_name,
          });


          // Reload the saved fundamentals
          const {
            data: refreshed,
            error:
              refreshedError,
          } = await supabase
            .from("fundamentals")
            .select("*")
            .eq(
              "instrument_id",
              instrument.id
            )
            .limit(1);


          if (
            refreshedError ||
            !refreshed?.[0]
          ) {

            skipped.push({
              symbol:
                instrument.symbol,

              company_name:
                instrument.company_name,

              reason:
                "Fundamentals synced but could not be reloaded.",
            });

            continue;
          }


          fundamental =
            refreshed[0];

        } catch (error) {

          skipped.push({
            symbol:
              instrument.symbol,

            company_name:
              instrument.company_name,

            reason:
              error instanceof Error
                ? error.message
                : String(error),
          });

          continue;
        }
      }


      // ----------------------------------------------
      // CALCULATE SCORE
      // ----------------------------------------------

      const score =
        calculateScore(
          fundamental
        );


      // ----------------------------------------------
      // SAVE AI SCORE
      // ----------------------------------------------

      const record = {

        /*
         * Your table currently has
         * UNIQUE(instrument_id).
         *
         * Therefore we intentionally
         * use instrument_id as the
         * conflict target.
         */

        instrument_id:
          instrument.id,

        /*
         * Keep user_id when available.
         * The score remains instrument-level.
         */

        user_id:
          holding.user_id ||
          null,

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
        error:
          saveScoreError,
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


      if (saveScoreError) {

        skipped.push({
          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          reason:
            saveScoreError.message,

          step:
            "save_score",
        });

        continue;
      }


      // ----------------------------------------------
      // RESULT
      // ----------------------------------------------

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
          saved?.id ||
          null,
      });
    }


    // ==================================================
    // 6. SUMMARY
    // ==================================================

    const scores =
      results.map(
        (item) =>
          Number(
            item.score
          )
      );


    const averageScore =
      scores.length
        ? Math.round(
            scores.reduce(
              (a, b) =>
                a + b,
              0
            ) /
              scores.length
          )
        : null;


    const actions = {};


    for (
      const result of results
    ) {

      actions[
        result.action
      ] =
        (
          actions[
            result.action
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

        newly_synced:
          synced.length,

        scored:
          results.length,

        skipped:
          skipped.length,

        average_score:
          averageScore,

        actions,
      },

      synced,

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

        step:
          "server",

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
