import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BASE_URL =
  "https://bharatstockapi.com/v1/stocks";


// ======================================================
// HELPERS
// ======================================================

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}


function calculateGrowth(current, previous) {
  const currentValue =
    numberOrNull(current);

  const previousValue =
    numberOrNull(previous);

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


// ======================================================
// BHARATSTOCK API
// ======================================================

async function callBharatStock(
  endpoint,
  apiKey
) {
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

  const text =
    await response.text();

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


// ======================================================
// SYNC ONE STOCK
// ======================================================

async function syncOneStock(
  supabase,
  bharatStockApiKey,
  instrument
) {
  const symbol =
    instrument.symbol;

  // ----------------------------------------------------
  // FINANCIALS
  // ----------------------------------------------------

  const financialResponse =
    await callBharatStock(
      `${symbol}/financials?period_type=annual&page=1&page_size=5`,
      bharatStockApiKey
    );

  const financialData =
    financialResponse?.data;

  if (
    !Array.isArray(financialData) ||
    financialData.length === 0
  ) {
    throw new Error(
      "BharatStock returned no annual financial data."
    );
  }


  // ----------------------------------------------------
  // SORT FINANCIAL YEARS
  // ----------------------------------------------------

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
    throw new Error(
      "Could not identify latest financial period."
    );
  }


  // ----------------------------------------------------
  // SALES GROWTH
  // ----------------------------------------------------

  const salesGrowth =
    previous
      ? calculateGrowth(
          latest.revenue,
          previous.revenue
        )
      : null;


  // ----------------------------------------------------
  // PROFIT GROWTH
  // ----------------------------------------------------

  const profitGrowth =
    previous
      ? calculateGrowth(
          latest.net_profit,
          previous.net_profit
        )
      : null;


  // ----------------------------------------------------
  // ROE
  // ----------------------------------------------------

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


  // ----------------------------------------------------
  // ROCE
  // ----------------------------------------------------

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

    if (capitalEmployed > 0) {
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


  // ----------------------------------------------------
  // DEBT / EQUITY
  // ----------------------------------------------------

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


  // ----------------------------------------------------
  // OPERATING CASH FLOW
  // ----------------------------------------------------

  const operatingCashFlow =
    numberOrNull(
      latest.cash_flow_operating
    );


  // ====================================================
  // SHAREHOLDING
  // ====================================================

  const shareholdingResponse =
    await callBharatStock(
      `${symbol}/shareholding`,
      bharatStockApiKey
    );

  let shareholdingData =
    shareholdingResponse
      ?.data
      ?.data;

  // Safety fallback
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
    throw new Error(
      "BharatStock returned no shareholding data."
    );
  }

  const latestShareholding =
    shareholdingData[0];


  // ====================================================
  // RATIOS / VALUATION
  // ====================================================

  const ratioResponse =
    await callBharatStock(
      `${symbol}/ratios`,
      bharatStockApiKey
    );

  const ratios =
    ratioResponse;

  if (
    !ratios ||
    typeof ratios !==
      "object" ||
    Array.isArray(ratios)
  ) {
    throw new Error(
      "BharatStock returned invalid ratio data."
    );
  }


  // ====================================================
  // DATABASE RECORD
  // ====================================================

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

    operating_cash_flow:
      operatingCashFlow,

    free_cash_flow:
      null,


    // Shareholding

    promoter_holding:
      numberOrNull(
        latestShareholding
          .promoter_pct
      ),

    promoter_pledge:
      null,

    fii_holding:
      numberOrNull(
        latestShareholding
          .fii_pct
      ),

    dii_holding:
      numberOrNull(
        latestShareholding
          .dii_pct
      ),


    // Period

    financial_year:
      latest.fiscal_year ||
      null,

    quarter:
      latest.quarter ||
      null,


    // Source

    source:
      "BharatStock",

    updated_at:
      new Date().toISOString(),


    // Valuation

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
      latestShareholding
        .as_on_date ||
      null,
  };


  // ====================================================
  // UPSERT
  // ====================================================

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
    throw new Error(
      saveError.message
    );
  }


  // ====================================================
  // RETURN RESULT
  // ====================================================

  return {

    symbol:
      instrument.symbol,

    company_name:
      instrument.company_name,

    instrument_id:
      instrument.id,

    financial_year:
      latest.fiscal_year,

    previous_year:
      previous?.fiscal_year ||
      null,

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

    promoter_holding:
      record.promoter_holding,

    fii_holding:
      record.fii_holding,

    dii_holding:
      record.dii_holding,

    market_cap:
      record.market_cap,

    pe_ratio:
      record.pe_ratio,

    pb_ratio:
      record.pb_ratio,

    saved_id:
      savedRecord?.id ||
      null,
  };
}


// ======================================================
// GET /api/sync-portfolio
// ======================================================

export async function GET() {

  try {

    // ==================================================
    // ENVIRONMENT VARIABLES
    // ==================================================

    const supabaseUrl =
      process.env
        .NEXT_PUBLIC_SUPABASE_URL;

    const supabaseSecretKey =
      process.env
        .SUPABASE_SECRET_KEY;

    const bharatStockApiKey =
      process.env
        .BHARATSTOCK_API_KEY;


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


    // ==================================================
    // SUPABASE
    // ==================================================

    const supabase =
      createClient(
        supabaseUrl,
        supabaseSecretKey
      );


    // ==================================================
    // GET HOLDINGS
    // ==================================================

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
      .from("holdings")
      .select(
        "instrument_id"
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
          "No holdings found.",
      });
    }


    // ==================================================
    // UNIQUE INSTRUMENT IDS
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
    // GET INSTRUMENTS
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


    // ==================================================
    // SYNC
    // ==================================================

    const successful = [];
    const failed = [];


    for (
      const instrument of
        instruments || []
    ) {

      try {

        const result =
          await syncOneStock(
            supabase,
            bharatStockApiKey,
            instrument
          );

        successful.push(
          result
        );

      } catch (error) {

        failed.push({

          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          instrument_id:
            instrument.id,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }


    // ==================================================
    // FINAL RESPONSE
    // ==================================================

    return NextResponse.json({

      success: true,

      message:
        "Portfolio fundamentals synchronization completed.",

      summary: {

        total_holdings:
          holdings.length,

        unique_instruments:
          instrumentIds.length,

        successful:
          successful.length,

        failed:
          failed.length,
      },

      successful,

      failed,
    });


  } catch (error) {

    console.error(
      "Portfolio sync error:",
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
