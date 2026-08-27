import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://bharatstockapi.com/v1/stocks";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function calculateGrowth(current, previous) {
  const currentValue = numberOrNull(current);
  const previousValue = numberOrNull(previous);

  if (
    currentValue === null ||
    previousValue === null ||
    previousValue === 0
  ) {
    return null;
  }

  return Number(
    (
      ((currentValue - previousValue) /
        Math.abs(previousValue)) *
      100
    ).toFixed(2)
  );
}

async function callBharatStock(endpoint, apiKey) {
  const response = await fetch(
    `${BASE_URL}/${endpoint}`,
    {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `BharatStock ${response.status}: ${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );
  }

  return data;
}

export async function GET(request) {
  try {
    // =====================================================
    // 1. ENVIRONMENT VARIABLES
    // =====================================================

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseSecretKey =
      process.env.SUPABASE_SECRET_KEY;

    const bharatStockApiKey =
      process.env.BHARATSTOCK_API_KEY;

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

    if (!bharatStockApiKey) {
      return NextResponse.json({
        success: false,
        step: "configuration",
        error:
          "BHARATSTOCK_API_KEY is missing",
      });
    }

    // =====================================================
    // 2. SUPABASE CLIENT
    // =====================================================

    const supabase = createClient(
      supabaseUrl,
      supabaseSecretKey
    );

    // =====================================================
    // 3. SYMBOL
    // =====================================================

    const { searchParams } =
      new URL(request.url);

    const requestedSymbol =
      searchParams.get("symbol") ||
      "INE263A01024";

    // =====================================================
    // 4. FIND INSTRUMENT
    // =====================================================

    const {
      data: instruments,
      error: instrumentError,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name"
      )
      .eq(
        "symbol",
        requestedSymbol
      )
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
          `No instrument found for ${requestedSymbol}`,
      });
    }

    const instrument =
      instruments[0];

    // =====================================================
    // 5. FINANCIALS
    // =====================================================

    const financialResponse =
      await callBharatStock(
        `${requestedSymbol}/financials?period_type=annual&page=1&page_size=5`,
        bharatStockApiKey
      );

    /*
     * Actual successful BharatStock financial response:

     {
       "data": [
         {...},
         {...}
       ]
     }

     Therefore:
       financialResponse.data
     */

    const financialData =
      financialResponse?.data;

    if (
      !Array.isArray(
        financialData
      ) ||
      financialData.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "financials",
        error:
          "BharatStock returned no annual financial data.",
        debug: {
          response:
            financialResponse,
        },
      });
    }

    const annuals =
      financialData
        .filter(
          (item) =>
            item &&
            item.period_end_date
        )
        .sort(
          (a, b) =>
            new Date(
              b.period_end_date
            ) -
            new Date(
              a.period_end_date
            )
        );

    const latest =
      annuals[0];

    const previous =
      annuals[1] || null;

    if (!latest) {
      return NextResponse.json({
        success: false,
        step: "financials",
        error:
          "Could not identify latest financial period.",
      });
    }

    // =====================================================
    // 6. FINANCIAL CALCULATIONS
    // =====================================================

    const salesGrowth =
      previous
        ? calculateGrowth(
            latest.revenue,
            previous.revenue
          )
        : null;

    const profitGrowth =
      previous
        ? calculateGrowth(
            latest.net_profit,
            previous.net_profit
          )
        : null;

    const netProfit =
      numberOrNull(
        latest.net_profit
      );

    const totalEquity =
      numberOrNull(
        latest.total_equity
      );

    let calculatedROE = null;

    if (
      netProfit !== null &&
      totalEquity !== null &&
      totalEquity !== 0
    ) {
      calculatedROE =
        Number(
          (
            (netProfit /
              totalEquity) *
            100
          ).toFixed(2)
        );
    }

    const operatingProfit =
      numberOrNull(
        latest.operating_profit
      );

    const totalAssets =
      numberOrNull(
        latest.total_assets
      );

    const currentLiabilities =
      numberOrNull(
        latest.current_liabilities
      );

    let calculatedROCE = null;

    if (
      operatingProfit !== null &&
      totalAssets !== null &&
      currentLiabilities !== null
    ) {
      const capitalEmployed =
        totalAssets -
        currentLiabilities;

      if (
        capitalEmployed > 0
      ) {
        calculatedROCE =
          Number(
            (
              (operatingProfit /
                capitalEmployed) *
              100
            ).toFixed(2)
          );
      }
    }

    let debtToEquity =
      numberOrNull(
        latest.debt_equity_ratio
      );

    if (
      debtToEquity === null
    ) {
      const nonCurrentDebt =
        numberOrNull(
          latest.borrowings_non_current
        ) || 0;

      const currentDebt =
        numberOrNull(
          latest.borrowings_current
        ) || 0;

      const totalDebt =
        nonCurrentDebt +
        currentDebt;

      if (
        totalEquity !== null &&
        totalEquity > 0
      ) {
        debtToEquity =
          Number(
            (
              totalDebt /
              totalEquity
            ).toFixed(3)
          );
      }
    }

    const operatingCashFlow =
      numberOrNull(
        latest.cash_flow_operating
      );

    // =====================================================
    // 7. SHAREHOLDING
    // =====================================================

    const shareholdingResponse =
      await callBharatStock(
        `${requestedSymbol}/shareholding`,
        bharatStockApiKey
      );

    /*
     * IMPORTANT:

     * Successful test response was:

     * {
     *   "data": {
     *     "data": [
     *       {
     *         "promoter_pct": 51.14,
     *         "fii_pct": 18.02,
     *         "dii_pct": 21.02
     *       }
     *     ]
     *   }
     * }

     * So we use:
     *
     * shareholdingResponse.data.data
     */

    let shareholdingData =
      shareholdingResponse?.data?.data;

    /*
     * Extra safety:
     *
     * If BharatStock ever returns the array
     * directly under data, also support that.
     */

    if (
      !Array.isArray(
        shareholdingData
      ) &&
      Array.isArray(
        shareholdingResponse?.data
      )
    ) {
      shareholdingData =
        shareholdingResponse.data;
    }

    if (
      !Array.isArray(
        shareholdingData
      ) ||
      shareholdingData.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "shareholding",
        error:
          "BharatStock returned no shareholding data.",
        debug: {
          response:
            shareholdingResponse,
        },
      });
    }

    const latestShareholding =
      shareholdingData[0];

    // =====================================================
    // 8. RATIOS
    // =====================================================

    const ratioResponse =
      await callBharatStock(
        `${requestedSymbol}/ratios`,
        bharatStockApiKey
      );

    const ratios =
      ratioResponse?.data;

    if (
      !ratios ||
      typeof ratios !==
        "object"
    ) {
      return NextResponse.json({
        success: false,
        step: "ratios",
        error:
          "BharatStock returned no ratio data.",
        debug: {
          response:
            ratioResponse,
        },
      });
    }

    // =====================================================
    // 9. BUILD RECORD
    // =====================================================

    const record = {
      instrument_id:
        instrument.id,

      sales_growth:
        salesGrowth,

      profit_growth:
        profitGrowth,

      roe:
        numberOrNull(
          ratios.roe
        ) ??
        calculatedROE,

      roce:
        numberOrNull(
          ratios.roce
        ) ??
        calculatedROCE,

      debt_to_equity:
        debtToEquity,

      promoter_holding:
        numberOrNull(
          latestShareholding.promoter_pct
        ),

      promoter_pledge:
        null,

      fii_holding:
        numberOrNull(
          latestShareholding.fii_pct
        ),

      dii_holding:
        numberOrNull(
          latestShareholding.dii_pct
        ),

      operating_cash_flow:
        operatingCashFlow,

      free_cash_flow:
        null,

      financial_year:
        latest.fiscal_year ||
        null,

      quarter:
        latest.quarter ||
        null,

      source:
        "BharatStock",

      updated_at:
        new Date().toISOString(),

      market_cap:
        numberOrNull(
          ratios.market_cap
        ),

      pe_ratio:
        numberOrNull(
          ratios.pe_ratio
        ),

      pb_ratio:
        numberOrNull(
          ratios.pb_ratio
        ),

      book_value_per_share:
        numberOrNull(
          ratios.book_value_per_share
        ),

      eps:
        numberOrNull(
          ratios.eps
        ),

      dividend_yield:
        numberOrNull(
          ratios.dividend_yield
        ),

      week_52_high:
        numberOrNull(
          ratios.week_52_high
        ),

      week_52_low:
        numberOrNull(
          ratios.week_52_low
        ),

      shareholding_date:
        latestShareholding.as_on_date ||
        null,
    };

    // =====================================================
    // 10. SAVE
    // =====================================================

    const {
      data: savedRecord,
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
      return NextResponse.json({
        success: false,
        step: "save_fundamentals",
        error:
          saveError.message,
        record_attempted:
          record,
      });
    }

    // =====================================================
    // 11. SUCCESS
    // =====================================================

    return NextResponse.json({
      success: true,

      message:
        `${instrument.company_name} fundamentals successfully synchronized.`,

      stock: {
        symbol:
          instrument.symbol,

        company_name:
          instrument.company_name,

        instrument_id:
          instrument.id,
      },

      source:
        "BharatStock",

      periods: {
        latest:
          latest.fiscal_year,

        previous:
          previous?.fiscal_year ||
          null,
      },

      calculated: {
        sales_growth:
          record.sales_growth,

        profit_growth:
          record.profit_growth,

        roe:
          record.roe,

        roce:
          record.roce,

        debt_to_equity:
          record.debt_to_equity,

        operating_cash_flow:
          record.operating_cash_flow,
      },

      shareholding: {
        as_on_date:
          latestShareholding.as_on_date,

        promoter_pct:
          record.promoter_holding,

        fii_pct:
          record.fii_holding,

        dii_pct:
          record.dii_holding,

        mutual_funds_pct:
          numberOrNull(
            latestShareholding.mutual_funds_pct
          ),
      },

      valuation: {
        as_of_date:
          ratios.as_of_date ||
          null,

        price:
          numberOrNull(
            ratios.price
          ),

        market_cap:
          record.market_cap,

        pe_ratio:
          record.pe_ratio,

        pb_ratio:
          record.pb_ratio,

        book_value_per_share:
          record.book_value_per_share,

        eps:
          record.eps,

        dividend_yield:
          record.dividend_yield,

        week_52_high:
          record.week_52_high,

        week_52_low:
          record.week_52_low,
      },

      saved_to:
        "fundamentals",

      saved_record:
        savedRecord,
    });
  } catch (error) {
    console.error(
      "Fundamentals sync error:",
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
