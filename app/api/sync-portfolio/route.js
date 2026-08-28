import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BASE_URL =
  "https://bharatstockapi.com/v1/stocks";

// ======================================================
// SETTINGS
// ======================================================

// Data newer than this will not be requested again.
const FRESHNESS_HOURS = 24;


// ======================================================
// SUPABASE
// ======================================================

function getSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_SECRET_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing."
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is missing."
    );
  }

  return createClient(
    url,
    key,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}


// ======================================================
// NUMBER HELPER
// ======================================================

function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


// ======================================================
// GROWTH CALCULATION
// ======================================================

function calculateGrowth(
  current,
  previous
) {

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
      (
        (currentValue -
          previousValue) /
        Math.abs(previousValue)
      ) *
      100
    ).toFixed(2)
  );
}


// ======================================================
// BHARATSTOCK REQUEST
// ======================================================

async function callBharatStock(
  endpoint,
  apiKey
) {

  const response =
    await fetch(
      `${BASE_URL}/${endpoint}`,
      {
        method: "GET",

        headers: {
          "X-API-Key": apiKey,
          Accept:
            "application/json",
        },

        cache: "no-store",
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data = text;
  }


  // ----------------------------------------------
  // RATE LIMIT
  // ----------------------------------------------

  if (
    response.status === 429
  ) {

    const error =
      new Error(
        "BHARATSTOCK_RATE_LIMIT"
      );

    error.status = 429;

    throw error;
  }


  // ----------------------------------------------
  // OTHER API ERRORS
  // ----------------------------------------------

  if (!response.ok) {

    const error =
      new Error(
        `BharatStock ${response.status}: ${
          typeof data === "string"
            ? data
            : JSON.stringify(data)
        }`
      );

    error.status =
      response.status;

    throw error;
  }


  return data;
}


// ======================================================
// CHECK IF DATA IS FRESH
// ======================================================

function isFresh(
  updatedAt
) {

  if (!updatedAt) {
    return false;
  }

  const updated =
    new Date(updatedAt);

  if (
    Number.isNaN(
      updated.getTime()
    )
  ) {
    return false;
  }

  const now =
    Date.now();

  const age =
    now -
    updated.getTime();

  const maxAge =
    FRESHNESS_HOURS *
    60 *
    60 *
    1000;

  return age < maxAge;
}


// ======================================================
// SYNC ONE STOCK
// ======================================================

async function syncOneStock(
  supabase,
  apiKey,
  instrument
) {

  const symbol =
    instrument.symbol;


  // ====================================================
  // FINANCIALS
  // ====================================================

  const financialResponse =
    await callBharatStock(
      `${symbol}/financials?period_type=annual&page=1&page_size=5`,
      apiKey
    );

  const financialData =
    financialResponse?.data;


  if (
    !Array.isArray(
      financialData
    ) ||
    financialData.length === 0
  ) {

    throw new Error(
      "BharatStock returned no annual financial data."
    );
  }


  // ====================================================
  // SORT FINANCIAL YEARS
  // ====================================================

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
    annuals[1] ||
    null;


  if (!latest) {

    throw new Error(
      "Could not identify latest financial period."
    );
  }


  // ====================================================
  // GROWTH
  // ====================================================

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


  // ====================================================
  // ROE
  // ====================================================

  const netProfit =
    numberOrNull(
      latest.net_profit
    );

  const totalEquity =
    numberOrNull(
      latest.total_equity
    );

  let calculatedROE =
    null;


  if (
    netProfit !== null &&
    totalEquity !== null &&
    totalEquity !== 0
  ) {

    calculatedROE =
      Number(
        (
          (
            netProfit /
            totalEquity
          ) *
          100
        ).toFixed(2)
      );
  }


  // ====================================================
  // ROCE
  // ====================================================

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

  let calculatedROCE =
    null;


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
            (
              operatingProfit /
              capitalEmployed
            ) *
            100
          ).toFixed(2)
        );
    }
  }


  // ====================================================
  // DEBT / EQUITY
  // ====================================================

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
          ).toFixed(4)
        );
    }
  }


  // ====================================================
  // OPERATING CASH FLOW
  // ====================================================

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
      apiKey
    );


  let shareholdingData =
    shareholdingResponse
      ?.data
      ?.data;


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
  // RATIOS
  // ====================================================

  const ratioResponse =
    await callBharatStock(
      `${symbol}/ratios`,
      apiKey
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
  // RECORD
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


    // Financial period

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
  // SAVE
  // ====================================================

  const {
    data: saved,
    error: saveError,
  } =
    await supabase
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
  // RETURN
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
      saved?.id ||
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
          "NEXT_PUBLIC_SUPABASE_URL is missing.",
      });
    }


    if (!supabaseSecretKey) {

      return NextResponse.json({
        success: false,
        step: "configuration",
        error:
          "SUPABASE_SECRET_KEY is missing.",
      });
    }


    if (!bharatStockApiKey) {

      return NextResponse.json({
        success: false,
        step: "configuration",
        error:
          "BHARATSTOCK_API_KEY is missing.",
      });
    }


    // ==================================================
    // SUPABASE
    // ==================================================

    const supabase =
      createClient(
        supabaseUrl,
        supabaseSecretKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      );


    // ==================================================
    // GET HOLDINGS
    // ==================================================

    const {
      data: holdings,
      error: holdingsError,
    } =
      await supabase
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
    } =
      await supabase
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
    // GET EXISTING FUNDAMENTALS
    // ==================================================

    const {
      data: existingFundamentals,
      error: fundamentalsError,
    } =
      await supabase
        .from("fundamentals")
        .select(
          "instrument_id, updated_at"
        )
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
      const item of
        existingFundamentals || []
    ) {

      fundamentalsMap.set(
        item.instrument_id,
        item
      );
    }


    // ==================================================
    // RESULTS
    // ==================================================

    const synced = [];
    const skipped = [];
    const failed = [];

    let rateLimitReached =
      false;


    // ==================================================
    // PROCESS STOCKS
    // ==================================================

    for (
      const instrument of
        instruments || []
    ) {

      // ----------------------------------------------
      // STOP AFTER RATE LIMIT
      // ----------------------------------------------

      if (
        rateLimitReached
      ) {

        skipped.push({

          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          instrument_id:
            instrument.id,

          reason:
            "Skipped because BharatStock daily rate limit was reached.",
        });

        continue;
      }


      // ----------------------------------------------
      // CHECK FRESH DATA
      // ----------------------------------------------

      const existing =
        fundamentalsMap.get(
          instrument.id
        );


      if (
        existing &&
        isFresh(
          existing.updated_at
        )
      ) {

        skipped.push({

          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          instrument_id:
            instrument.id,

          reason:
            "Fundamentals are already fresh.",

          updated_at:
            existing.updated_at,
        });

        continue;
      }


      // ----------------------------------------------
      // SYNC
      // ----------------------------------------------

      try {

        const result =
          await syncOneStock(
            supabase,
            bharatStockApiKey,
            instrument
          );


        synced.push(
          result
        );


      } catch (error) {

        // ------------------------------------------
        // RATE LIMIT
        // ------------------------------------------

        if (
          error?.status ===
            429 ||
          error?.message ===
            "BHARATSTOCK_RATE_LIMIT"
        ) {

          rateLimitReached =
            true;


          failed.push({

            symbol:
              instrument.symbol,

            company_name:
              instrument.company_name,

            instrument_id:
              instrument.id,

            reason:
              "BharatStock daily API limit reached.",

            status: 429,
          });

          continue;
        }


        // ------------------------------------------
        // OTHER FAILURE
        // ------------------------------------------

        failed.push({

          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          instrument_id:
            instrument.id,

          reason:
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
        "Smart portfolio synchronization completed.",

      settings: {

        freshness_hours:
          FRESHNESS_HOURS,
      },

      summary: {

        total_holdings:
          holdings.length,

        unique_instruments:
          instrumentIds.length,

        synced:
          synced.length,

        skipped:
          skipped.length,

        failed:
          failed.length,

        rate_limit_reached:
          rateLimitReached,
      },

      synced,

      skipped,

      failed,
    });


  } catch (error) {

    console.error(
      "Smart portfolio sync error:",
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
